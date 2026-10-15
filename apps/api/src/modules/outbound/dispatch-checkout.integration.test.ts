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

  it('needs a weighed withdrawal and outbound.finalize', async () => {
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
    expect((await preview(pendingId, operatorToken)).statusCode).toBe(403);
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

    const all = await app.inject({ method: 'GET', url: '/v1/outbound-events', headers: authHeaders(operatorToken) });
    expect(all.statusCode).toBe(200);
    const rows = data<any[]>(all);
    expect(rows.find((r) => r.id === booked.id)).toMatchObject({ stage: 'WEIGHED', vehicle_number: 'LHR-7701', owner_party_name: expect.any(String) });
    expect(rows.find((r) => r.vehicle_number === 'LHR-7702').stage).toBe('BOOKED');

    const onlyWeighed = data<any[]>(
      await app.inject({ method: 'GET', url: '/v1/outbound-events?status=WEIGHED', headers: authHeaders(operatorToken) }),
    );
    expect(onlyWeighed.map((r) => r.vehicle_number)).toEqual(['LHR-7701']);
    const byPlate = data<any[]>(
      await app.inject({ method: 'GET', url: '/v1/outbound-events?search=7702', headers: authHeaders(operatorToken) }),
    );
    expect(byPlate.map((r) => r.vehicle_number)).toEqual(['LHR-7702']);
    const today = new Date().toISOString().slice(0, 10);
    const dated = await app.inject({
      method: 'GET',
      url: `/v1/outbound-events?date_from=${today}&date_to=${today}`,
      headers: authHeaders(operatorToken),
    });
    expect(dated.statusCode).toBe(200);
    expect(data<any[]>(dated).length).toBe(2);
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
