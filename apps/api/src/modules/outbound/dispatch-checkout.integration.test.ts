/**
 * Dispatch desk (fast-dispatch Phase B): the withdrawal queue, the bill preview and the
 * one-transaction "dispatch & collect". The checkout composes dispatch, invoice finalize
 * and receipt, so what matters most is that it is all-or-nothing, that what was reviewed
 * is what posts, and that two clicks cannot take the money twice — every race asserts the
 * loser (CLAUDE.md).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import { businessDate } from '@coldchain/shared';
import type { FastifyInstance } from 'fastify';
import { DispatchCheckoutService } from './dispatch-checkout.service';

vi.mock('../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let operatorToken: string;
let securityToken: string;
let accountantToken: string;
let partyId: string;
let loadingChargeId: string;

type Res = { statusCode: number; body: string };
const code = (r: Res) => JSON.parse(r.body).error?.code as string | undefined;
// Loosely typed on purpose: these are API payloads inspected field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = <T = any>(r: Res) => JSON.parse(r.body).data as T;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.gatePass.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.partyCreditApproval.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { journalEntryId: null } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.lotMovement.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lotRackPlacement.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

async function createLot(quantity: number, token = operatorToken, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(token),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: quantity,
      accepted_weight_kg: quantity * 20,
      inbound_date: '2026-04-10',
      ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return data<{ id: string }>(res).id;
}

/** A booked-and-weighed FULL withdrawal of a fresh lot: ready for the checkout. */
async function weighed(quantity: number, opts: { lotExtra?: Record<string, unknown>; lotToken?: string; plate?: string } = {}) {
  const lotId = await createLot(quantity, opts.lotToken ?? operatorToken, opts.lotExtra);
  const create = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: quantity,
      outbound_date: '2026-09-01',
      vehicle_number: opts.plate ?? 'LHR-9001',
    },
  });
  expect(create.statusCode, create.body).toBe(201);
  const id = data<{ id: string }>(create).id;
  const w = await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${id}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: quantity * 19.5 },
  });
  expect(w.statusCode, w.body).toBe(200);
  return { id, lotId };
}

const preview = (id: string, token = managerToken) =>
  app.inject({ method: 'GET', url: `/v1/outbound-events/${id}/checkout-preview`, headers: authHeaders(token) });

function checkout(id: string, body: Record<string, unknown>, token = managerToken) {
  return app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${id}/dispatch-and-collect`,
    headers: authHeaders(token),
    payload: body,
  });
}

/** The request a reviewing manager would send for a bill previewed at `total`. */
const cash = (total: number, extra: Record<string, unknown> = {}) => ({
  expected_total_pkr: total,
  payment: { mode: 'CASH' },
  ...extra,
});

async function untouched(lotId: string, id: string, balance: number) {
  expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags).toBe(balance);
  expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).status).toBe('WEIGHED');
  expect(await prisma.invoice.count({ where: { outboundEventId: id } })).toBe(0);
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;

  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: `Checkout-Farmer-${Date.now()}`, party_type: 'FARMER', phone_primary: '03019390001' },
  });
  expect(party.statusCode, party.body).toBe(201);
  partyId = data<{ id: string }>(party).id;

  // A charge that belongs on every dispatch.
  const charge = await app.inject({
    method: 'POST',
    url: '/v1/service-charges',
    headers: authHeaders(managerToken),
    payload: { name: `Loading-${Date.now()}`, unit_type: 'PER_BAG', unit_price_pkr: 2, apply_at_dispatch: true },
  });
  expect(charge.statusCode, charge.body).toBe(201);
  loadingChargeId = data<{ id: string }>(charge).id;
}, 30_000);

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.serviceCharge.deleteMany({ where: { id: loadingChargeId } });
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

describe('checkout preview', () => {
  it('shows the storage line, the apply-at-dispatch service lines and the total — and writes nothing', async () => {
    const { id, lotId } = await weighed(100);
    const res = await preview(id);
    expect(res.statusCode, res.body).toBe(200);
    const p = data(res);
    expect(p.storage_line.amount_pkr).toBeGreaterThan(0);
    const loading = p.service_lines.find((l: { service_charge_id: string }) => l.service_charge_id === loadingChargeId);
    expect(loading).toMatchObject({ quantity: 100, unit_price_pkr: 2, amount_pkr: 200 });
    expect(p.total_pkr).toBeCloseTo(p.storage_line.amount_pkr + 200 + p.gst_amount_pkr, 2);
    await untouched(lotId, id, 100);
  });

  it('needs a weighed withdrawal and outbound.record (the guard is refused)', async () => {
    const lotId = await createLot(50);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 50, outbound_date: '2026-09-01', vehicle_number: 'LHR-9002' },
    });
    const pendingId = data<{ id: string }>(create).id;
    const notWeighed = await preview(pendingId);
    expect([notWeighed.statusCode, code(notWeighed)]).toEqual([422, 'OUTBOUND_WEIGHT_REQUIRED']);
    // The munshi reads the bill (the solo switch decides whether they may finish it).
    const asOperator = await preview(pendingId, operatorToken);
    expect([asOperator.statusCode, code(asOperator)]).toEqual([422, 'OUTBOUND_WEIGHT_REQUIRED']);
    expect((await preview(pendingId, securityToken)).statusCode).toBe(403);
  });

  it('tells the munshi whether they may finish the truck alone — booleans and a reason, never a ceiling', async () => {
    const { id } = await weighed(20);
    const off = data(await preview(id, operatorToken));
    expect(off.solo).toEqual({ allowed: false, reason: expect.stringContaining('one-person dispatch'), credit_available: false });
    expect(JSON.stringify(off.solo)).not.toMatch(/max|ceiling|exposure/i);
  });
});

describe('dispatch & collect', () => {
  it('on cash: dispatches, bills, posts the receipt, and the money is what the preview said', async () => {
    const { id, lotId } = await weighed(100);
    const total = data(await preview(id)).total_pkr as number;

    const res = await checkout(id, cash(total, { payment: { mode: 'CASH' } }));
    expect(res.statusCode, res.body).toBe(200);
    const body = data(res);
    expect(body.outbound.status).toBe('DISPATCHED');
    expect(body.invoice.status).toBe('FINALIZED');
    expect(body.invoice.total_pkr).toBeCloseTo(total, 2);
    expect(body.payment.receipt_number).toMatch(/^RCP-/);

    const lot = await prisma.lot.findUniqueOrThrow({ where: { id: lotId } });
    expect([lot.currentBalanceBags, lot.status]).toEqual([0, 'CLOSED']);
    const inv = await prisma.invoice.findFirstOrThrow({
      where: { outboundEventId: id },
      include: { lineItems: true },
    });
    expect(inv.journalEntryId).toBeTruthy();
    expect(Number(inv.amountPaidPkr)).toBeCloseTo(total, 2);
    expect(inv.lineItems.some((l) => l.serviceChargeId === loadingChargeId)).toBe(true);
    const pay = await prisma.payment.findFirstOrThrow({ where: { partyId }, include: { allocations: true } });
    expect(pay.journalEntryId).toBeTruthy();
    expect(pay.allocations).toHaveLength(1);
    // The queue now reads it as paid.
    const row = data<any[]>(
      await app.inject({ method: 'GET', url: `/v1/outbound-events?search=${body.outbound.dispatch_note_number}`, headers: authHeaders(managerToken) }),
    )[0];
    expect(row.stage).toBe('PAID');
  });

  it('on credit: the bill is finalized and posted, nothing is collected', async () => {
    const { id } = await weighed(60);
    const total = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, { expected_total_pkr: total, payment: { mode: 'CREDIT' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res).payment).toBeNull();
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
    expect([inv.status, Number(inv.amountPaidPkr)]).toEqual(['FINALIZED', 0]);
    expect(inv.journalEntryId).toBeTruthy();
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
  });

  it('a pre-added service line can be left off — a deliberate act that changes the total', async () => {
    const { id } = await weighed(100);
    const full = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, cash(full - 200, { skip_service_charge_ids: [loadingChargeId] }));
    expect(res.statusCode, res.body).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id }, include: { lineItems: true } });
    expect(inv.lineItems.some((l) => l.serviceChargeId === loadingChargeId)).toBe(false);
  });

  it('refuses a total that is not the one reviewed, and writes nothing', async () => {
    const { id, lotId } = await weighed(100);
    const total = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, cash(total - 50));
    expect([res.statusCode, code(res)]).toEqual([409, 'DISPATCH_TOTAL_CHANGED']);
    expect(JSON.parse(res.body).error.field).toBe('expected_total_pkr');
    await untouched(lotId, id, 100);
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
  });

  it('is all-or-nothing: when the receipt is refused, the dispatch and the bill roll back too', async () => {
    // A KATCHI receipt is OWNER-only, and it is refused at the LAST step — after the
    // lot has moved, the bill is built and JE-01 is posted. None of that may survive.
    const { id, lotId } = await weighed(100, { lotToken: ownerToken, lotExtra: { book_type: 'KATCHI' } });
    const total = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, cash(total));
    expect(res.statusCode).toBe(403);
    await untouched(lotId, id, 100);
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
    // The same withdrawal can still be completed on credit, then collected by the owner.
    const onCredit = await checkout(id, { expected_total_pkr: total, payment: { mode: 'CREDIT' } });
    expect(onCredit.statusCode, onCredit.body).toBe(200);
  });

  it('rack picks: the racks named are the ones reduced; a bad pick refuses the whole checkout and nothing moves', async () => {
    const rackA = '00000000-0000-0000-0000-000000000210';
    const rackB = '00000000-0000-0000-0000-000000000211';
    const lotId = await createLot(100, operatorToken, {
      placements: [
        { rack_id: rackA, bags: 60 },
        { rack_id: rackB, bags: 40 },
      ],
    });
    const create = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId, withdrawal_type: 'PARTIAL', quantity_withdrawn_bags: 50, outbound_date: '2026-09-01', vehicle_number: 'LHR-9002' },
    });
    expect(create.statusCode, create.body).toBe(201);
    const id = data<{ id: string }>(create).id;
    const w = await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${id}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 50 * 19.5 },
    });
    expect(w.statusCode, w.body).toBe(200);
    const total = data(await preview(id)).total_pkr as number;
    const racks = async () =>
      Object.fromEntries(
        (await prisma.lotRackPlacement.findMany({ where: { lotId } })).map((p) => [p.rackId, p.bags]),
      );

    // 45 bags off a rack that holds 40: the total (45) is within the 50 withdrawn, the rack is not.
    const bad = await checkout(id, cash(total, { picked_from: [{ rack_id: rackB, bags: 45 }] }));
    expect([bad.statusCode, code(bad)]).toEqual([400, 'VALIDATION_ERROR']);
    await untouched(lotId, id, 100);
    expect(await racks()).toEqual({ [rackA]: 60, [rackB]: 40 });
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);

    // The corrected pick goes through: 40 off B (emptied), 10 off A — not the auto-trim's choice.
    const good = await checkout(id, cash(total, { picked_from: [{ rack_id: rackB, bags: 40 }, { rack_id: rackA, bags: 10 }] }));
    expect(good.statusCode, good.body).toBe(200);
    expect(await racks()).toEqual({ [rackA]: 50 });
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags).toBe(50);
  });

  it('two checkouts of one withdrawal: one takes the money, the other is refused — one bill, one receipt', async () => {
    for (let round = 0; round < 3; round++) {
      const { id } = await weighed(40);
      const total = data(await preview(id)).total_pkr as number;
      const [a, b] = await Promise.all([checkout(id, cash(total)), checkout(id, cash(total))]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const loser = [a, b].find((r) => r.statusCode === 409)!;
      expect(code(loser)).toBe('OUTBOUND_ALREADY_FINALIZED');
      expect(await prisma.invoice.count({ where: { outboundEventId: id } })).toBe(1);
      const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
      expect(await prisma.paymentAllocation.count({ where: { invoiceId: inv.id } })).toBe(1);
      await cleanup();
    }
  });

  it('needs the money keys: the route wants outbound.finalize; a missing invoices.manage / payments.record is named before any write', async () => {
    const { id, lotId } = await weighed(30);
    const total = data(await preview(id)).total_pkr as number;
    // Munshi and accountant do not hold outbound.finalize.
    expect((await checkout(id, cash(total), operatorToken)).statusCode).toBe(403);
    expect((await checkout(id, cash(total), accountantToken)).statusCode).toBe(403);
    expect((await checkout(id, cash(total), securityToken)).statusCode).toBe(403);
    await untouched(lotId, id, 30);

    // A caller holding outbound.finalize but not the money keys (an owner-customised matrix).
    const svc = new DispatchCheckoutService(prisma, null as never, null as never, null as never);
    const caller = (keys: string[]) => ({ facilityId: TEST_FACILITY_ID, userId: 'u', role: 'MANAGER', permissions: new Set(keys) });
    await expect(svc.dispatchAndCollect(caller(['outbound.finalize']), id, cash(total) as never)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing permission: invoices.manage',
    });
    await expect(
      svc.dispatchAndCollect(caller(['outbound.finalize', 'invoices.manage']), id, cash(total) as never),
    ).rejects.toMatchObject({ message: 'Missing permission: payments.record' });
    // On credit no receipt is recorded, so payments.record is not needed.
    await expect(
      svc.dispatchAndCollect(caller(['outbound.finalize']), id, { expected_total_pkr: total, payment: { mode: 'CREDIT' } } as never),
    ).rejects.toMatchObject({ message: 'Missing permission: invoices.manage' });
    await untouched(lotId, id, 30);
  });

  it('a cheque needs its date', async () => {
    const { id } = await weighed(30);
    const total = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, { expected_total_pkr: total, payment: { mode: 'CHEQUE' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('the queue', () => {
  it('lists withdrawals with their stage, filtered by status, searched by dispatch note, plate or lot', async () => {
    const booked = await weighed(10, { plate: 'LHR-7701' }); // weighed
    const lotId = await createLot(20);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 20, outbound_date: '2026-09-01', vehicle_number: 'LHR-7702' },
    });
    expect(create.statusCode).toBe(201);

    const all = await app.inject({ method: 'GET', url: '/v1/outbound-events?page_size=100', headers: authHeaders(operatorToken) });
    expect(all.statusCode).toBe(200);
    const rows = data<any[]>(all);
    expect(rows.find((r) => r.id === booked.id)).toMatchObject({ stage: 'WEIGHED', vehicle_number: 'LHR-7701', owner_party_name: expect.any(String) });
    expect(rows.find((r) => r.vehicle_number === 'LHR-7702').stage).toBe('BOOKED');

    // Other suites share this facility, so look only at the rows this test made.
    const mine = (rs: any[]) => rs.filter((r) => ['LHR-7701', 'LHR-7702'].includes(r.vehicle_number));
    const onlyWeighed = data<any[]>(
      await app.inject({ method: 'GET', url: '/v1/outbound-events?status=WEIGHED&page_size=100', headers: authHeaders(operatorToken) }),
    );
    expect(mine(onlyWeighed).map((r) => r.vehicle_number)).toEqual(['LHR-7701']);
    const byPlate = data<any[]>(
      await app.inject({ method: 'GET', url: '/v1/outbound-events?search=7702', headers: authHeaders(operatorToken) }),
    );
    expect(mine(byPlate).map((r) => r.vehicle_number)).toEqual(['LHR-7702']);
    // The queue's days are the facility's (Lahore), which is not the UTC date for part of every day.
    const today = businessDate();
    const dated = await app.inject({
      method: 'GET',
      url: `/v1/outbound-events?date_from=${today}&date_to=${today}&page_size=100`,
      headers: authHeaders(operatorToken),
    });
    expect(dated.statusCode).toBe(200);
    expect(mine(data<any[]>(dated))).toHaveLength(2);
    const bad = await app.inject({ method: 'GET', url: '/v1/outbound-events?status=NOPE', headers: authHeaders(operatorToken) });
    expect([bad.statusCode, code(bad)]).toEqual([400, 'VALIDATION_ERROR']);
  });

  it('is not for the guard: SECURITY (who counts the bags blind) cannot read it', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/outbound-events', headers: authHeaders(securityToken) });
    expect(res.statusCode).toBe(403);
  });

  it('shows a dispatched, billed and unpaid withdrawal as DISPATCHED, with what is still owed', async () => {
    const { id } = await weighed(50);
    const total = data(await preview(id)).total_pkr as number;
    await checkout(id, { expected_total_pkr: total, payment: { mode: 'CREDIT' } });
    const row = data<any[]>(
      await app.inject({ method: 'GET', url: '/v1/outbound-events?status=DISPATCHED', headers: authHeaders(managerToken) }),
    )[0];
    expect(row.stage).toBe('DISPATCHED');
    expect(row.invoice).toMatchObject({ status: 'FINALIZED', total_pkr: total, balance_due_pkr: total });
  });
});

describe('solo dispatch (the owner lets the munshi finish a clean truck)', () => {
  const setSolo = async (on: boolean) => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { dispatch_solo_mode: on } },
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const approve = async (max: number) => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/parties/${partyId}/credit-approval`,
      headers: authHeaders(managerToken),
      payload: { max_outstanding_pkr: max },
    });
    expect(res.statusCode, res.body).toBe(201);
  };
  const credit = (total: number) => ({ expected_total_pkr: total, payment: { mode: 'CREDIT' } });
  const nothingWritten = async () => {
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
  };
  const refusedAsManagerJob = (r: Res) => expect([r.statusCode, code(r)]).toEqual([403, 'DISPATCH_NEEDS_MANAGER']);

  afterAll(() => setSolo(false));

  it('switch off: the munshi is told a manager must finish it, and nothing is written', async () => {
    await setSolo(false);
    const { id, lotId } = await weighed(30);
    const total = data(await preview(id)).total_pkr as number;
    refusedAsManagerJob(await checkout(id, cash(total), operatorToken));
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('switch on: the munshi takes cash in full alone — dispatched, billed, paid, with their own name on it', async () => {
    await setSolo(true);
    const { id } = await weighed(30);
    const p = data(await preview(id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: true, credit_available: false });
    const res = await checkout(id, cash(p.total_pkr), operatorToken);
    expect(res.statusCode, res.body).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
    expect(inv.status).toBe('FINALIZED');
    expect(Number(inv.amountPaidPkr)).toBeCloseTo(p.total_pkr, 2);
    const out = await prisma.outboundEvent.findUniqueOrThrow({ where: { id } });
    expect(out.status).toBe('DISPATCHED');
    expect(out.finalizedBy).not.toBeNull();
    const pay = await prisma.payment.findFirstOrThrow({ where: { partyId } });
    expect(pay.createdBy).toBe(out.finalizedBy);
  });

  it('switch on: everything but cash or approved credit still needs a manager, and each refusal writes nothing', async () => {
    await setSolo(true);
    const { id, lotId } = await weighed(30);
    const total = data(await preview(id)).total_pkr as number;
    refusedAsManagerJob(await checkout(id, cash(total, { skip_service_charge_ids: [loadingChargeId] }), operatorToken));
    refusedAsManagerJob(await checkout(id, { expected_total_pkr: total, payment: { mode: 'CHEQUE', cheque_date: businessDate() } }, operatorToken));
    refusedAsManagerJob(await checkout(id, { expected_total_pkr: total, payment: { mode: 'BANK_TRANSFER' } }, operatorToken));
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken)); // no standing approval
    await untouched(lotId, id, 30);
    await nothingWritten();
    // The manager's own path is unchanged by the switch.
    const skipped = await checkout(id, cash(total - 60, { skip_service_charge_ids: [loadingChargeId] }));
    expect(skipped.statusCode, skipped.body).toBe(200);
  });

  it('switch on: a KATCHI-book truck is a manager decision', async () => {
    await setSolo(true);
    const { id, lotId } = await weighed(30, { lotToken: ownerToken, lotExtra: { book_type: 'KATCHI' } });
    const p = data(await preview(id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: false, credit_available: false });
    refusedAsManagerJob(await checkout(id, cash(p.total_pkr), operatorToken));
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('on credit: a standing approval that covers the bill lets the munshi finish it; the gate then agrees', async () => {
    await setSolo(true);
    await approve(1_000_000);
    const { id } = await weighed(30);
    const p = data(await preview(id, operatorToken));
    expect(p.solo.credit_available).toBe(true);
    const res = await checkout(id, credit(p.total_pkr), operatorToken);
    expect(res.statusCode, res.body).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
    expect(Number(inv.totalPkr) - Number(inv.amountPaidPkr)).toBeCloseTo(p.total_pkr, 2);
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
  });

  it('on credit: a ceiling the bill would pass, a lapsed or a revoked approval each send it to a manager', async () => {
    await setSolo(true);
    const { id, lotId } = await weighed(30);
    const total = data(await preview(id)).total_pkr as number;

    await approve(Math.floor(total) - 1); // one rupee short of this bill
    expect(data(await preview(id, operatorToken)).solo.credit_available).toBe(false);
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken));
    await untouched(lotId, id, 30);
    await nothingWritten();

    await approve(1_000_000);
    await prisma.partyCreditApproval.updateMany({
      where: { facilityId: TEST_FACILITY_ID, partyId, revokedAt: null },
      data: { validUntil: new Date('2020-01-01') },
    });
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken));

    await prisma.partyCreditApproval.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await approve(1_000_000);
    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/parties/${partyId}/credit-approval/revoke`,
      headers: authHeaders(managerToken),
      payload: { reason: 'Party stopped paying' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken));
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('two credit dispatches that each fit the ceiling but not together: one goes, the other is refused', async () => {
    await setSolo(true);
    const a = await weighed(40, { plate: 'LHR-9101' });
    const b = await weighed(40, { plate: 'LHR-9102' });
    const total = data(await preview(a.id)).total_pkr as number;
    await approve(Math.round(total * 1.5)); // room for one bill, not two
    const [ra, rb] = await Promise.all([
      checkout(a.id, credit(total), operatorToken),
      checkout(b.id, credit(total), operatorToken),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 403]);
    refusedAsManagerJob([ra, rb].find((r) => r.statusCode === 403)!);
    expect(await prisma.invoice.count({ where: { outboundEventId: { in: [a.id, b.id] }, status: 'FINALIZED' } })).toBe(1);
    // The loser left no trace: its lot still holds its bags and it is still weighed.
    const loser = ra.statusCode === 403 ? a : b;
    await untouched(loser.lotId, loser.id, 40);
  });
});
