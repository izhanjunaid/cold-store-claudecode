/**
 * Dispatch desk (fast-dispatch Phase B): the withdrawal queue, the bill preview and the
 * one-transaction "dispatch & collect". The checkout composes dispatch, invoice finalize
 * and receipt, so what matters most is that it is all-or-nothing, that what was reviewed
 * is what posts, and that two clicks cannot take the money twice — every race asserts the
 * loser (CLAUDE.md).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import { addDays, businessDate } from '@coldchain/shared';
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

/** A booked FULL withdrawal of a fresh lot, not weighed: ready for the checkout, weight being optional (docs/27). */
async function booked(quantity: number, opts: { lotExtra?: Record<string, unknown>; lotToken?: string; plate?: string; date?: string } = {}) {
  const lotId = await createLot(quantity, opts.lotToken ?? operatorToken, opts.lotExtra);
  const create = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: quantity,
      outbound_date: opts.date ?? '2026-09-01',
      vehicle_number: opts.plate ?? 'LHR-9001',
    },
  });
  expect(create.statusCode, create.body).toBe(201);
  return { id: data<{ id: string }>(create).id, lotId };
}

const weigh = (id: string, kg: number) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${id}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: kg },
  });

/** The same, weighed. */
async function weighed(quantity: number, opts: Parameters<typeof booked>[1] = {}) {
  const b = await booked(quantity, opts);
  const w = await weigh(b.id, quantity * 19.5);
  expect(w.statusCode, w.body).toBe(200);
  return b;
}

const activePerTonCharges = () =>
  prisma.serviceCharge.count({ where: { facilityId: TEST_FACILITY_ID, isActive: true, unitType: 'PER_TON' } });

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

async function untouched(lotId: string, id: string, balance: number, status: 'WEIGHED' | 'PENDING' = 'WEIGHED') {
  expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags).toBe(balance);
  expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).status).toBe(status);
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

// Rows a test made that bills reference: removed after cleanup() has removed the bills.
const extraChargeIds: string[] = [];
const extraRatePlanIds: string[] = [];

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.serviceCharge.deleteMany({ where: { id: { in: [loadingChargeId, ...extraChargeIds] } } });
    await prisma.ratePlan.deleteMany({ where: { id: { in: extraRatePlanIds } } });
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

  it('a booked withdrawal previews and checks out without a weight; the guard is refused', async () => {
    // A per-ton dispatch charge would need a weight (docs/27): this fixture has none.
    expect(await activePerTonCharges()).toBe(0);
    const { id, lotId } = await booked(50, { plate: 'LHR-9002' });
    const p = await preview(id);
    expect(p.statusCode, p.body).toBe(200);
    // The munshi reads the bill (the solo switch decides whether they may finish it).
    expect((await preview(id, operatorToken)).statusCode).toBe(200);
    expect((await preview(id, securityToken)).statusCode).toBe(403);

    const res = await checkout(id, cash(data(p).total_pkr));
    expect(res.statusCode, res.body).toBe(200);
    const out = await prisma.outboundEvent.findUniqueOrThrow({ where: { id } });
    expect([out.status, out.outboundWeightKg]).toEqual(['DISPATCHED', null]);
    expect((await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } })).status).toBe('FINALIZED');
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags).toBe(0);
  });

  it('tells the munshi whether they may finish the truck alone — booleans and a reason, never a ceiling', async () => {
    const { id } = await weighed(20);
    const off = data(await preview(id, operatorToken));
    expect(off.solo).toEqual({
      allowed: false,
      reason: expect.stringContaining('one-person dispatch'),
      reason_code: 'SOLO_OFF',
      credit_available: false,
    });
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
    // The one-truck answer keeps its shape when the checkout is cut into lines (C2).
    expect(Object.keys(body).sort()).toEqual(['invoice', 'outbound', 'payment']);
    expect(Object.keys(body.payment).sort()).toEqual(['id', 'receipt_number']);
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

  it('a default charge priced at zero adds no line, and does not block the checkout', async () => {
    const free = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: { name: `Free-gate-${Date.now()}`, unit_type: 'FLAT', unit_price_pkr: 0, apply_at_dispatch: true },
    });
    expect(free.statusCode, free.body).toBe(201);
    const freeId = data<{ id: string }>(free).id;
    try {
      const { id } = await weighed(20);
      const p = data(await preview(id));
      expect((p.service_lines as { service_charge_id: string }[]).some((l) => l.service_charge_id === freeId)).toBe(false);
      const res = await checkout(id, cash(p.total_pkr));
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      await prisma.invoiceLineItem.deleteMany({ where: { serviceChargeId: freeId } });
      await prisma.serviceCharge.delete({ where: { id: freeId } });
    }
  });

  it('a bill whose lines fall on a half-paisa GST posts the total the preview showed', async () => {
    // 102.55 storage + two 0.10 charges = 102.75, and 18% of that is exactly 18.495: summed as floats
    // the bill used to round its GST down and refuse the checkout's total forever.
    const facility = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } });
    const original = facility.settings;
    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: { settings: { ...(original as object), gst_registered: true, gst_default_rate: 18 } as never },
    });
    await prisma.serviceCharge.update({ where: { id: loadingChargeId }, data: { isActive: false } });
    try {
      const plan = await app.inject({
        method: 'POST',
        url: '/v1/rate-plans',
        headers: authHeaders(managerToken),
        payload: {
          name: `Half-paisa-${Date.now()}`,
          commodity_id: POTATO_ID,
          rate_type: 'SEASONAL_PER_BAG',
          rate_amount_pkr: 102.55,
          season_start_date: '2026-03-01',
          season_end_date: '2026-12-31',
          min_billing_days: 1,
        },
      });
      expect(plan.statusCode, plan.body).toBe(201);
      extraRatePlanIds.push(data<{ id: string }>(plan).id);
      for (const name of ['Dime-A', 'Dime-B']) {
        const charge = await app.inject({
          method: 'POST',
          url: '/v1/service-charges',
          headers: authHeaders(managerToken),
          payload: { name: `${name}-${Date.now()}`, unit_type: 'FLAT', unit_price_pkr: 0.1, apply_at_dispatch: true },
        });
        expect(charge.statusCode, charge.body).toBe(201);
        extraChargeIds.push(data<{ id: string }>(charge).id);
      }

      const { id } = await weighed(1, { lotExtra: { rate_plan_id: data<{ id: string }>(plan).id } });
      const p = data(await preview(id));
      // The premise, so the test cannot pass on a different bill.
      expect(p.storage_line.amount_pkr).toBe(102.55);
      expect((p.service_lines as { amount_pkr: number }[]).map((l) => l.amount_pkr)).toEqual([0.1, 0.1]);
      expect([p.sub_total_pkr, p.gst_amount_pkr, p.total_pkr]).toEqual([102.75, 18.5, 121.25]);

      const res = await checkout(id, cash(p.total_pkr));
      expect(res.statusCode, res.body).toBe(200);
      const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
      expect(Number(inv.totalPkr)).toBe(121.25);
    } finally {
      await prisma.serviceCharge.updateMany({ where: { id: { in: extraChargeIds } }, data: { isActive: false } });
      await prisma.serviceCharge.update({ where: { id: loadingChargeId }, data: { isActive: true } });
      await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: original as never } });
    }
  });

  it('refuses a total that is not the one reviewed, and writes nothing', async () => {
    const { id, lotId } = await weighed(100);
    const total = data(await preview(id)).total_pkr as number;
    const res = await checkout(id, cash(total - 50));
    expect([res.statusCode, code(res)]).toEqual([409, 'DISPATCH_TOTAL_CHANGED']);
    expect(JSON.parse(res.body).error.field).toBe('expected_total_pkr');
    // One withdrawal: the message names no dispatch note (a truck's names the line).
    expect(JSON.parse(res.body).error.message).toMatch(/^The bill is now Rs \d+\.\d{2}, not the Rs \d+\.\d{2} shown/);
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

  // Three rounds of two racing checkouts outran the 15 s default on a loaded machine (under 3 s
  // alone); the assertions are unchanged.
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
  }, 45_000);

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

  // Weight optional (docs/27): a per-ton charge is the one thing that still needs a weight.
  describe('a per-ton charge on a withdrawal with no weight', () => {
    let perTon: { id: string; name: string };
    beforeAll(async () => {
      perTon = await prisma.serviceCharge.create({
        data: { facilityId: TEST_FACILITY_ID, name: `Weighbridge-${Date.now()}`, unitType: 'PER_TON', unitPricePkr: 500, applyAtDispatch: true },
      });
      extraChargeIds.push(perTon.id);
    });
    // Deactivated, not deleted, until afterAll: bills of later files must not meet it.
    afterAll(() => prisma.serviceCharge.update({ where: { id: perTon.id }, data: { isActive: false } }));
    const perTonLine = (p: { service_lines: { service_charge_id: string }[] }) =>
      p.service_lines.find((l) => l.service_charge_id === perTon.id);

    it('is never billed at zero: the checkout is refused, naming the lot and the charge, until the weight is recorded', async () => {
      const { id, lotId } = await booked(30);
      const p = data(await preview(id));
      expect(perTonLine(p)).toMatchObject({ needs_weight: true, amount_pkr: 0 });

      const refused = await checkout(id, cash(p.total_pkr));
      expect([refused.statusCode, code(refused)]).toEqual([422, 'OUTBOUND_WEIGHT_REQUIRED']);
      const dn = (await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).dispatchNoteNumber!;
      expect(JSON.parse(refused.body).error.message).toContain(dn);
      expect(JSON.parse(refused.body).error.message).toContain(perTon.name);
      await untouched(lotId, id, 30, 'PENDING');

      expect((await weigh(id, 2000)).statusCode).toBe(200);
      const weighedP = data(await preview(id));
      expect(perTonLine(weighedP)).toMatchObject({ needs_weight: false, quantity: 2, amount_pkr: 1000 });
      const ok = await checkout(id, cash(weighedP.total_pkr));
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it('a manager may leave it off the bill instead', async () => {
      const { id } = await booked(30);
      const p = data(await preview(id));
      const res = await checkout(id, cash(p.total_pkr, { skip_service_charge_ids: [perTon.id] }));
      expect(res.statusCode, res.body).toBe(200);
      const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: id } });
      expect(await prisma.invoiceLineItem.count({ where: { invoiceId: inv.id, serviceChargeId: perTon.id } })).toBe(0);
    });
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

/** The owner's one-person dispatch switch. */
async function setSolo(on: boolean) {
  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/facilities/me',
    headers: authHeaders(ownerToken),
    payload: { settings: { dispatch_solo_mode: on } },
  });
  expect(res.statusCode, res.body).toBe(200);
}

describe('solo dispatch (the owner lets the munshi finish a clean truck)', () => {
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
  // The refusal names its reason as a code (docs/28 D6), and nothing else: never a figure.
  const refusedAsManagerJob = (r: Res, reason: string) => {
    const error = JSON.parse(r.body).error;
    expect([r.statusCode, error?.code, error?.details]).toEqual([403, 'DISPATCH_NEEDS_MANAGER', { reason_code: reason }]);
  };
  // A truck the munshi may finish alone is booked today: the date sets the storage billed.
  const today = (quantity: number, opts: Parameters<typeof weighed>[1] = {}) => weighed(quantity, { ...opts, date: businessDate() });

  afterAll(() => setSolo(false));

  it('switch off: the munshi is told a manager must finish it, and nothing is written', async () => {
    await setSolo(false);
    const { id, lotId } = await today(30);
    const total = data(await preview(id)).total_pkr as number;
    refusedAsManagerJob(await checkout(id, cash(total), operatorToken), 'SOLO_OFF');
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('the solo rules cover a booked withdrawal too (weight is optional, docs/27)', async () => {
    await setSolo(false);
    const off = await booked(30, { date: businessDate() });
    refusedAsManagerJob(await checkout(off.id, cash(data(await preview(off.id)).total_pkr), operatorToken), 'SOLO_OFF');
    await untouched(off.lotId, off.id, 30, 'PENDING');

    await setSolo(true);
    const old = await booked(30); // booked for 2026-09-01: its date sets the storage billed
    const p = data(await preview(old.id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: false, reason_code: 'NOT_TODAY', credit_available: false });
    expect(p.solo.reason).toMatch(/dated/);
    refusedAsManagerJob(await checkout(old.id, cash(p.total_pkr), operatorToken), 'NOT_TODAY');
    await untouched(old.lotId, old.id, 30, 'PENDING');
    await nothingWritten();

    // A clean one, booked today and never weighed, the munshi finishes alone.
    const clean = await booked(30, { date: businessDate() });
    const pc = data(await preview(clean.id, operatorToken));
    expect(pc.solo).toMatchObject({ allowed: true });
    const ok = await checkout(clean.id, cash(pc.total_pkr), operatorToken);
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('switch on: the munshi takes cash in full alone — dispatched, billed, paid, with their own name on it', async () => {
    await setSolo(true);
    const { id } = await today(30);
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
    const { id, lotId } = await today(30);
    const total = data(await preview(id)).total_pkr as number;
    refusedAsManagerJob(await checkout(id, cash(total, { skip_service_charge_ids: [loadingChargeId] }), operatorToken), 'SKIP_CHARGE');
    refusedAsManagerJob(
      await checkout(id, { expected_total_pkr: total, payment: { mode: 'CHEQUE', cheque_date: businessDate() } }, operatorToken),
      'PAYMENT_MODE',
    );
    refusedAsManagerJob(await checkout(id, { expected_total_pkr: total, payment: { mode: 'BANK_TRANSFER' } }, operatorToken), 'PAYMENT_MODE');
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken), 'NO_STANDING_CREDIT'); // no standing approval
    await untouched(lotId, id, 30);
    await nothingWritten();
    // The manager's own path is unchanged by the switch.
    const skipped = await checkout(id, cash(total - 60, { skip_service_charge_ids: [loadingChargeId] }));
    expect(skipped.statusCode, skipped.body).toBe(200);
  });

it('switch on: a truck dated before today is a manager decision — its date sets the storage billed', async () => {
    await setSolo(true);
    const { id, lotId } = await weighed(30); // booked for 2026-09-01
    const p = data(await preview(id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: false, reason_code: 'NOT_TODAY', credit_available: false });
    expect(p.solo.reason).toMatch(/dated/);
    refusedAsManagerJob(await checkout(id, cash(p.total_pkr), operatorToken), 'NOT_TODAY');
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('switch on: a charge priced by the weight the munshi typed is a manager decision', async () => {
    await setSolo(true);
    const perTon = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: { name: `Weighbridge-${Date.now()}`, unit_type: 'PER_TON', unit_price_pkr: 50, apply_at_dispatch: true },
    });
    expect(perTon.statusCode, perTon.body).toBe(201);
    try {
      const { id, lotId } = await today(30);
      const p = data(await preview(id, operatorToken));
      expect(p.solo).toMatchObject({ allowed: false, reason_code: 'PER_TON_CHARGE', credit_available: false });
      expect(p.solo.reason).toMatch(/weight/);
      refusedAsManagerJob(await checkout(id, cash(p.total_pkr), operatorToken), 'PER_TON_CHARGE');
      await untouched(lotId, id, 30);
      await nothingWritten();
    } finally {
      await prisma.serviceCharge.delete({ where: { id: data<{ id: string }>(perTon).id } });
    }
  });

  it('switch on: a KATCHI-book truck is a manager decision', async () => {
    await setSolo(true);
    const { id, lotId } = await today(30, { lotToken: ownerToken, lotExtra: { book_type: 'KATCHI' } });
    const p = data(await preview(id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: false, reason_code: 'KATCHI', credit_available: false });
    refusedAsManagerJob(await checkout(id, cash(p.total_pkr), operatorToken), 'KATCHI');
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('on credit: a standing approval that covers the bill lets the munshi finish it; the gate then agrees', async () => {
    await setSolo(true);
    await approve(1_000_000);
    const { id } = await today(30);
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
    const { id, lotId } = await today(30);
    const total = data(await preview(id)).total_pkr as number;

    await approve(Math.floor(total) - 1); // one rupee short of this bill
    expect(data(await preview(id, operatorToken)).solo.credit_available).toBe(false);
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken), 'OVER_CREDIT_CEILING');
    await untouched(lotId, id, 30);
    await nothingWritten();

    await approve(1_000_000);
    await prisma.partyCreditApproval.updateMany({
      where: { facilityId: TEST_FACILITY_ID, partyId, revokedAt: null },
      data: { validUntil: new Date('2020-01-01') },
    });
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken), 'NO_STANDING_CREDIT');

    await prisma.partyCreditApproval.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await approve(1_000_000);
    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/parties/${partyId}/credit-approval/revoke`,
      headers: authHeaders(managerToken),
      payload: { reason: 'Party stopped paying' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    refusedAsManagerJob(await checkout(id, credit(total), operatorToken), 'NO_STANDING_CREDIT');
    await untouched(lotId, id, 30);
    await nothingWritten();
  });

  it('two credit dispatches that each fit the ceiling but not together: one goes, the other is refused', async () => {
    await setSolo(true);
    const a = await today(40, { plate: 'LHR-9101' });
    const b = await today(40, { plate: 'LHR-9102' });
    const total = data(await preview(a.id)).total_pkr as number;
    await approve(Math.round(total * 1.5)); // room for one bill, not two
    const [ra, rb] = await Promise.all([
      checkout(a.id, credit(total), operatorToken),
      checkout(b.id, credit(total), operatorToken),
    ]);
    expect([ra.statusCode, rb.statusCode].sort()).toEqual([200, 403]);
    refusedAsManagerJob([ra, rb].find((r) => r.statusCode === 403)!, 'OVER_CREDIT_CEILING');
    expect(await prisma.invoice.count({ where: { outboundEventId: { in: [a.id, b.id] }, status: 'FINALIZED' } })).toBe(1);
    // The loser left no trace: its lot still holds its bags and it is still weighed.
    const loser = ra.statusCode === 403 ? a : b;
    await untouched(loser.lotId, loser.id, 40);
  });
});

describe('waiting for a manager (docs/28 D6, O6, O7)', () => {
  type Waiting = { id: string; reason_code: string | null; ask_code: string | null; asked_at: string | null };
  const waiting = (token = managerToken) =>
    app.inject({ method: 'GET', url: '/v1/dispatch/waiting', headers: authHeaders(token) });
  const ask = (ids: string[], askCode = 'CALLED', token = operatorToken) =>
    app.inject({
      method: 'POST',
      url: '/v1/dispatch/ask-manager',
      headers: authHeaders(token),
      payload: { outbound_ids: ids, ask_code: askCode },
    });
  const listed = async () => {
    const res = await waiting();
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    return { rows: body.data as Waiting[], total: body.meta.total as number };
  };
  const row = (rows: Waiting[], id: string) => rows.find((r) => r.id === id);
  const cancel = async (id: string) => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${id}/cancel`,
      headers: authHeaders(operatorToken),
      payload: { reason: 'The buyer left' },
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const dispatchIt = async (id: string) => {
    const res = await checkout(id, cash(data(await preview(id)).total_pkr));
    expect(res.statusCode, res.body).toBe(200);
  };
  const askedAt = async (id: string) => (await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).managerAskAt;

  afterAll(() => setSolo(false));

  it('with one-person dispatch off every ready withdrawal of any date waits, as SOLO_OFF', async () => {
    await setSolo(false);
    const fresh = await booked(10, { date: businessDate(), plate: 'LHR-7001' });
    const old = await weighed(10, { date: addDays(businessDate(), -10), plate: 'LHR-7002' });
    const gone = await weighed(10, { plate: 'LHR-7003' });
    await dispatchIt(gone.id);
    const cancelled = await booked(10, { plate: 'LHR-7004' });
    await cancel(cancelled.id);
    const disputed = await booked(10, { plate: 'LHR-7005' });
    await prisma.outboundEvent.update({ where: { id: disputed.id }, data: { status: 'DISPUTED' } });

    const { rows, total } = await listed();
    expect(row(rows, fresh.id)).toMatchObject({ reason_code: 'SOLO_OFF', ask_code: null, asked_at: null });
    expect(row(rows, old.id)).toMatchObject({ reason_code: 'SOLO_OFF' });
    for (const id of [gone.id, cancelled.id, disputed.id]) expect(row(rows, id)).toBeUndefined();
    // Every ready row waits while the switch is off: other files may leave rows here, so count, don't fix a number.
    expect(total).toBe(
      await prisma.outboundEvent.count({ where: { facilityId: TEST_FACILITY_ID, status: { in: ['PENDING', 'WEIGHED'] } } }),
    );
  });

  it('the desk’s list shows when a withdrawal was called', async () => {
    const b = await booked(10, { date: businessDate(), plate: 'LHR-7006' });
    const res = await ask([b.id], 'CHEQUE_OR_TRANSFER');
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res)).toMatchObject({ asked: 1, asked_at: expect.any(String) });
    const queue = await app.inject({
      method: 'GET',
      url: '/v1/outbound-events?status=PENDING,WEIGHED',
      headers: authHeaders(operatorToken),
    });
    expect(data<Waiting[]>(queue).find((r) => r.id === b.id)).toMatchObject({
      ask_code: 'CHEQUE_OR_TRANSFER',
      asked_at: expect.any(String),
    });
  });

  it('with it on, a withdrawal the munshi can finish is not listed, and the munshi can finish it', async () => {
    await setSolo(true);
    expect(await activePerTonCharges()).toBe(0);
    const clean = await booked(30, { date: businessDate(), plate: 'LHR-7007' });
    expect(row((await listed()).rows, clean.id)).toBeUndefined();
    const p = data(await preview(clean.id, operatorToken));
    expect(p.solo.allowed).toBe(true);
    const res = await checkout(clean.id, cash(p.total_pkr), operatorToken);
    expect(res.statusCode, res.body).toBe(200);
  });

  it('with it on, KATCHI, not-today and per-ton rows are listed with their codes', async () => {
    await setSolo(true);
    const katchi = await booked(10, { date: businessDate(), plate: 'LHR-7008', lotToken: ownerToken, lotExtra: { book_type: 'KATCHI' } });
    const old = await booked(10, { plate: 'LHR-7009' }); // booked for 2026-09-01
    const clean = await booked(10, { date: businessDate(), plate: 'LHR-7010' });
    let { rows } = await listed();
    expect(row(rows, katchi.id)?.reason_code).toBe('KATCHI');
    expect(row(rows, old.id)?.reason_code).toBe('NOT_TODAY');
    expect(row(rows, clean.id)).toBeUndefined();

    const perTon = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: { name: `Weighbridge-${Date.now()}`, unit_type: 'PER_TON', unit_price_pkr: 50, apply_at_dispatch: true },
    });
    expect(perTon.statusCode, perTon.body).toBe(201);
    try {
      ({ rows } = await listed());
      expect(row(rows, clean.id)?.reason_code).toBe('PER_TON_CHARGE');
    } finally {
      await prisma.serviceCharge.delete({ where: { id: data<{ id: string }>(perTon).id } });
    }
  });

  it('a call puts a withdrawal the munshi could finish on the list, first, with its ask code and time', async () => {
    await setSolo(true);
    const a = await booked(10, { date: businessDate(), plate: 'LHR-7020' });
    const old = await booked(10, { plate: 'LHR-7021' });
    expect(row((await listed()).rows, a.id)).toBeUndefined();
    expect((await ask([a.id], 'CREDIT')).statusCode).toBe(200);
    const { rows } = await listed();
    expect(rows[0]).toMatchObject({ id: a.id, reason_code: null, ask_code: 'CREDIT', asked_at: expect.any(String) });
    expect(row(rows, old.id)).toMatchObject({ reason_code: 'NOT_TODAY', ask_code: null });
  });

  it('a call stamps only this facility’s booked or weighed rows', async () => {
    const ready = await booked(10, { plate: 'LHR-7030' });
    const done = await weighed(10, { plate: 'LHR-7031' });
    await dispatchIt(done.id);

    const res = await ask([ready.id, done.id]);
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res).asked).toBe(1);
    expect(await askedAt(ready.id)).not.toBeNull();
    expect(await askedAt(done.id)).toBeNull();

    const none = await ask([done.id]);
    expect([none.statusCode, code(none)]).toEqual([409, 'OUTBOUND_NOT_WAITING']);

    // A caller from another facility cannot reach this facility's withdrawal.
    const fresh = await booked(10, { plate: 'LHR-7032' });
    const svc = new DispatchCheckoutService(prisma, null as never, null as never, null as never);
    await expect(
      svc.askManager('00000000-0000-0000-0000-0000000000ff', { outbound_ids: [fresh.id], ask_code: 'CALLED' }),
    ).rejects.toMatchObject({ code: 'OUTBOUND_NOT_WAITING' });
    expect(await askedAt(fresh.id)).toBeNull();
  });

  it('a dispatched or cancelled withdrawal leaves the list', async () => {
    await setSolo(false);
    const a = await weighed(10, { plate: 'LHR-7040' });
    const b = await booked(10, { plate: 'LHR-7041' });
    expect((await ask([a.id, b.id])).statusCode).toBe(200);
    let { rows } = await listed();
    expect([row(rows, a.id), row(rows, b.id)].every(Boolean)).toBe(true);
    await dispatchIt(a.id);
    await cancel(b.id);
    ({ rows } = await listed());
    expect([row(rows, a.id), row(rows, b.id)]).toEqual([undefined, undefined]);
  });

  it('today’s rows come before older ones', async () => {
    await setSolo(false);
    const old = await booked(10, { plate: 'LHR-7050' }); // booked for 2026-09-01
    const fresh = await booked(10, { date: businessDate(), plate: 'LHR-7051' });
    const ids = (await listed()).rows.map((r) => r.id);
    expect(ids.indexOf(fresh.id)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(fresh.id)).toBeLessThan(ids.indexOf(old.id));
  });

  it('only the manager keys read the list; the guard cannot call a manager', async () => {
    expect((await waiting(operatorToken)).statusCode).toBe(403);
    expect((await waiting(accountantToken)).statusCode).toBe(403);
    expect((await waiting(securityToken)).statusCode).toBe(403);
    expect((await waiting(managerToken)).statusCode).toBe(200);
    const b = await booked(10, { plate: 'LHR-7060' });
    expect((await ask([b.id], 'CALLED', securityToken)).statusCode).toBe(403);
  });
});

describe('a manager allows what the munshi asked for (docs/28 O8-O11)', () => {
  type Allowed = {
    id: string;
    reason_code: string | null;
    ask_code: string | null;
    allows: string[];
    allowed_by_name: string | null;
    allowed_at: string | null;
    settled: boolean;
  };
  const ask = (ids: string[], askCode = 'CHEQUE_OR_TRANSFER') =>
    app.inject({
      method: 'POST',
      url: '/v1/dispatch/ask-manager',
      headers: authHeaders(operatorToken),
      payload: { outbound_ids: ids, ask_code: askCode },
    });
  const allow = (ids: string[], allows: string[], token = managerToken) =>
    app.inject({
      method: 'POST',
      url: '/v1/dispatch/allow',
      headers: authHeaders(token),
      payload: { outbound_ids: ids, allows },
    });
  const waiting = async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/dispatch/waiting', headers: authHeaders(managerToken) });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    return { rows: body.data as Allowed[], total: body.meta.total as number, listed: body.meta.listed as number };
  };
  const managerRow = () => prisma.user.findFirstOrThrow({ where: { email: 'manager@coldchain.pk' } });
  const cheque = (total: number, extra: Record<string, unknown> = {}) => ({
    expected_total_pkr: total,
    payment: { mode: 'CHEQUE', reference_number: 'MCB-0001', cheque_date: businessDate() },
    ...extra,
  });
  const credit = (total: number) => ({ expected_total_pkr: total, payment: { mode: 'CREDIT' } });
  const refused = (r: Res, reason: string) => {
    const error = JSON.parse(r.body).error;
    expect([r.statusCode, error?.code, error?.details]).toEqual([403, 'DISPATCH_NEEDS_MANAGER', { reason_code: reason }]);
  };
  /** A booked withdrawal of today, 100 bags (the loading charge is Rs 200), that the munshi has called on. */
  const calledToday = async (plate: string, askCode = 'CHEQUE_OR_TRANSFER') => {
    const b = await booked(100, { date: businessDate(), plate });
    expect((await ask([b.id], askCode)).statusCode).toBe(200);
    return b;
  };
  const longAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

  beforeAll(async () => {
    await setSolo(true);
  });
  afterAll(() => setSolo(false));
  beforeEach(async () => {
    await prisma.partyCreditApproval.deleteMany({ where: { partyId } });
  });

  it('only a manager allows: the munshi, the guard and the accountant get 403; an allowance names who gave it and when', async () => {
    const b = await calledToday('LHR-7101');
    for (const token of [operatorToken, securityToken, accountantToken]) {
      expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'], token)).statusCode).toBe(403);
    }
    const res = await allow([b.id], ['CHEQUE_OR_TRANSFER']);
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res)).toMatchObject({ allowed: 1, allowed_at: expect.any(String) });
    const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } });
    expect(row).toMatchObject({ managerAllows: ['CHEQUE_OR_TRANSFER'], managerAllowedBy: (await managerRow()).id });
    expect(row.managerAllowedAt).toBeTruthy();
  });

  it('allow stamps only booked or weighed rows; an id that is no withdrawal here, or none still waiting, is 409', async () => {
    const live = await calledToday('LHR-7102');
    const gone = await weighed(10, { date: businessDate(), plate: 'LHR-7103' });
    expect((await checkout(gone.id, cash(data(await preview(gone.id)).total_pkr))).statusCode).toBe(200);

    const mixed = await allow([live.id, gone.id], ['CHEQUE_OR_TRANSFER']);
    expect(mixed.statusCode, mixed.body).toBe(200);
    expect(data(mixed).allowed).toBe(1);
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: gone.id } })).managerAllows).toEqual([]);

    const none = await allow([gone.id, '11111111-1111-4111-8111-111111111111'], ['CREDIT']);
    expect([none.statusCode, code(none)]).toEqual([409, 'OUTBOUND_NOT_WAITING']);
  });

  it('a row that fails a solo rule cannot be allowed anything: 409 ALLOW_DOES_NOT_HELP, and the rule is named', async () => {
    const katchi = await booked(10, { date: businessDate(), plate: 'LHR-7104', lotToken: ownerToken, lotExtra: { book_type: 'KATCHI' } });
    const old = await booked(10, { plate: 'LHR-7105' }); // booked for 2026-09-01
    for (const [row, reasonCode] of [
      [katchi, 'KATCHI'],
      [old, 'NOT_TODAY'],
    ] as const) {
      const res = await allow([row.id], ['CHEQUE_OR_TRANSFER']);
      const error = JSON.parse(res.body).error;
      expect([res.statusCode, error.code, error.details]).toEqual([409, 'ALLOW_DOES_NOT_HELP', { reason_code: reasonCode }]);
      expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: row.id } })).managerAllows).toEqual([]);
    }
    await setSolo(false);
    try {
      const off = await booked(10, { date: businessDate(), plate: 'LHR-7106' });
      const res = await allow([off.id], ['CREDIT']);
      expect([res.statusCode, JSON.parse(res.body).error.details]).toEqual([409, { reason_code: 'SOLO_OFF' }]);
    } finally {
      await setSolo(true);
    }
  });

  it('the service itself wants invoices.manage as well: a caller holding outbound.finalize alone is refused', async () => {
    const b = await calledToday('LHR-7199');
    const svc = new DispatchCheckoutService(prisma, null as never, null as never, null as never);
    const caller = (keys: string[]) => ({ facilityId: TEST_FACILITY_ID, userId: 'u', role: 'MANAGER', permissions: new Set(keys) });
    await expect(svc.allow(caller(['outbound.finalize']), { outbound_ids: [b.id], allows: ['CREDIT'] })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Missing permission: invoices.manage',
    });
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } })).managerAllows).toEqual([]);
  });

  it('taking it back clears it', async () => {
    const b = await calledToday('LHR-7107');
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    expect((await allow([b.id], [])).statusCode).toBe(200);
    expect(await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({
      managerAllows: [],
      managerAllowedBy: null,
      managerAllowedAt: null,
    });
  });

  it('cheque, transfer and wallet: refused until allowed, then the munshi takes it, with their own name on the payment', async () => {
    const b = await calledToday('LHR-7110');
    const total = data(await preview(b.id, operatorToken)).total_pkr as number;
    refused(await checkout(b.id, cheque(total), operatorToken), 'PAYMENT_MODE');
    await untouched(b.lotId, b.id, 100, 'PENDING');

    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    const ok = await checkout(b.id, cheque(total), operatorToken);
    expect(ok.statusCode, ok.body).toBe(200);
    const out = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } });
    const pay = await prisma.payment.findFirstOrThrow({ where: { partyId } });
    expect(pay).toMatchObject({ paymentMethod: 'CHEQUE', createdBy: out.finalizedBy });
    expect(out.finalizedBy).not.toBe((await managerRow()).id);

    const wallet = await calledToday('LHR-7111');
    expect((await allow([wallet.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    const w = await checkout(
      wallet.id,
      { expected_total_pkr: total, payment: { mode: 'BANK_TRANSFER', reference_number: 'TRF-77' } },
      operatorToken,
    );
    expect(w.statusCode, w.body).toBe(200);
  });

  it('credit: refused without an approval, then allowed on this bill; over a standing ceiling too; the manager is the authority', async () => {
    const b = await calledToday('LHR-7120', 'CREDIT');
    const total = data(await preview(b.id, operatorToken)).total_pkr as number;
    refused(await checkout(b.id, credit(total), operatorToken), 'NO_STANDING_CREDIT');

    expect((await allow([b.id], ['CREDIT'])).statusCode).toBe(200);
    const p = data(await preview(b.id, operatorToken));
    expect(p.solo).toMatchObject({ allowed: true, credit_available: true });
    const ok = await checkout(b.id, credit(total), operatorToken);
    expect(ok.statusCode, ok.body).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: b.id } });
    expect(Number(inv.totalPkr) - Number(inv.amountPaidPkr)).toBeCloseTo(total, 2);
    const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.creditAllowedBy).toBe((await managerRow()).id);

    // A standing approval too small for the bill: the munshi alone is stopped at the ceiling, the allowance is not.
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/parties/${partyId}/credit-approval`,
      headers: authHeaders(managerToken),
      payload: { max_outstanding_pkr: 1 },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const big = await calledToday('LHR-7121', 'CREDIT');
    const bigTotal = data(await preview(big.id, operatorToken)).total_pkr as number;
    refused(await checkout(big.id, credit(bigTotal), operatorToken), 'OVER_CREDIT_CEILING');
    expect((await allow([big.id], ['CREDIT'])).statusCode).toBe(200);
    const done = await checkout(big.id, credit(bigTotal), operatorToken);
    expect(done.statusCode, done.body).toBe(200);
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: big.id } })).creditAllowedBy).toBe((await managerRow()).id);
  });

  it('a manager who finishes the row themselves is the authority, not the one who allowed it', async () => {
    const b = await calledToday('LHR-7125', 'CREDIT');
    expect((await allow([b.id], ['CREDIT'])).statusCode).toBe(200);
    const total = data(await preview(b.id)).total_pkr as number;
    const res = await checkout(b.id, credit(total)); // the manager's own checkout
    expect(res.statusCode, res.body).toBe(200);
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: b.id } })).creditAllowedBy).toBeNull();
  });

  it('leaving a charge off: refused until allowed, then the munshi may', async () => {
    const b = await calledToday('LHR-7130', 'LEAVE_CHARGE_OFF');
    const full = data(await preview(b.id, operatorToken)).total_pkr as number;
    const skip = { skip_service_charge_ids: [loadingChargeId] };
    refused(await checkout(b.id, cash(full - 200, skip), operatorToken), 'SKIP_CHARGE');

    expect((await allow([b.id], ['LEAVE_CHARGE_OFF'])).statusCode).toBe(200);
    const ok = await checkout(b.id, cash(full - 200, skip), operatorToken);
    expect(ok.statusCode, ok.body).toBe(200);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: b.id }, include: { lineItems: true } });
    expect(inv.lineItems.some((l) => l.serviceChargeId === loadingChargeId)).toBe(false);
  });

  it('allowing one thing lifts only that thing', async () => {
    const b = await calledToday('LHR-7135', 'CALLED'); // a plain call: the manager chooses what to allow
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER', 'CREDIT'])).statusCode).toBe(200);
    const full = data(await preview(b.id, operatorToken)).total_pkr as number;
    refused(await checkout(b.id, cash(full - 200, { skip_service_charge_ids: [loadingChargeId] }), operatorToken), 'SKIP_CHARGE');
  });

  it("an allowance from an earlier day lifts nothing, and a taken-back one refuses with the ask's code", async () => {
    const b = await calledToday('LHR-7140');
    const total = data(await preview(b.id, operatorToken)).total_pkr as number;
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    await prisma.outboundEvent.update({ where: { id: b.id }, data: { managerAllowedAt: longAgo(2) } });
    refused(await checkout(b.id, cheque(total), operatorToken), 'PAYMENT_MODE');

    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    expect((await allow([b.id], [])).statusCode).toBe(200);
    refused(await checkout(b.id, cheque(total), operatorToken), 'PAYMENT_MODE');
    await untouched(b.lotId, b.id, 100, 'PENDING');
  });

  it('the waiting list puts allowed rows last and counts only the rest; an old allowance is a called row again', async () => {
    const first = await calledToday('LHR-7150');
    const second = await calledToday('LHR-7151');
    const old = await calledToday('LHR-7152');
    expect((await allow([second.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    expect((await allow([old.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    await prisma.outboundEvent.update({ where: { id: old.id }, data: { managerAllowedAt: longAgo(3) } });

    const { rows, total, listed } = await waiting();
    const ids = rows.map((r) => r.id);
    // `second` is allowed and sorts after the rows that still wait, though it was called before `old`.
    expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf(first.id));
    expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf(old.id));
    expect(rows.find((r) => r.id === second.id)).toMatchObject({
      allows: ['CHEQUE_OR_TRANSFER'],
      allowed_by_name: expect.any(String),
      allowed_at: expect.any(String),
    });
    expect(rows.find((r) => r.id === old.id)).toMatchObject({ allows: [], allowed_by_name: null, allowed_at: null });
    // The count is what still needs a manager; `listed` is every row on the list.
    expect(listed).toBe(rows.length);
    expect(total).toBe(rows.filter((r) => r.allows.length === 0).length);
    expect(total).toBe(listed - 1);
  });

  it('a manager allows only what the munshi asked for: another thing is refused, a plain call lets them choose, an uncalled row has nothing to allow (O8)', async () => {
    // Asked for credit: a cheque, or a charge left off, is not what was asked for.
    const credit = await calledToday('LHR-7195', 'CREDIT');
    for (const extra of [['CHEQUE_OR_TRANSFER'], ['CREDIT', 'LEAVE_CHARGE_OFF']]) {
      const res = await allow([credit.id], extra);
      const error = JSON.parse(res.body).error;
      expect([res.statusCode, error.code, error.details]).toEqual([409, 'ALLOW_NOT_ASKED', { ask_code: 'CREDIT' }]);
    }
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: credit.id } })).managerAllows).toEqual([]);
    expect((await allow([credit.id], ['CREDIT'])).statusCode).toBe(200);

    // The buyer then asks for a cheque too: it can be allowed, and what was allowed before is kept (an allowance replaces the list).
    expect((await ask([credit.id], 'CHEQUE_OR_TRANSFER')).statusCode).toBe(200);
    expect((await allow([credit.id], ['CREDIT', 'LEAVE_CHARGE_OFF'])).statusCode).toBe(409);
    expect((await allow([credit.id], ['CREDIT', 'CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);

    // A plain call says nothing in particular: the manager chooses what to allow.
    const plain = await calledToday('LHR-7196', 'CALLED');
    expect((await allow([plain.id], ['CHEQUE_OR_TRANSFER', 'LEAVE_CHARGE_OFF'])).statusCode).toBe(200);

    // A withdrawal nobody called about has nothing to allow; taking back is always possible.
    const quiet = await booked(10, { date: businessDate(), plate: 'LHR-7197' });
    const nothing = await allow([quiet.id], ['CREDIT']);
    expect([nothing.statusCode, JSON.parse(nothing.body).error.code, JSON.parse(nothing.body).error.details]).toEqual([409, 'ALLOW_NOT_ASKED', { ask_code: null }]);
    expect((await allow([quiet.id], [])).statusCode).toBe(200);
  });

  it('a call made after the allowance puts the row back on what waits: the buyer changed what they want', async () => {
    const b = await calledToday('LHR-7190', 'CREDIT');
    expect((await allow([b.id], ['CREDIT'])).statusCode).toBe(200);
    let { rows, total, listed } = await waiting();
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ settled: true, allows: ['CREDIT'] });
    expect(total).toBe(listed - rows.filter((r) => r.settled).length);

    // The buyer now wants a cheque instead: a newer call than the allowance, so a manager has something to read.
    expect((await ask([b.id], 'CHEQUE_OR_TRANSFER')).statusCode).toBe(200);
    ({ rows, total, listed } = await waiting());
    expect(rows.find((r) => r.id === b.id)).toMatchObject({ settled: false, ask_code: 'CHEQUE_OR_TRANSFER', allows: ['CREDIT'] });
    expect(total).toBe(rows.filter((r) => !r.settled).length);
    expect(listed).toBe(rows.length);
  });

  it('a solo rule that starts failing after the allowance puts the row back on what waits', async () => {
    const b = await calledToday('LHR-7191');
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    await setSolo(false); // the owner switches one-person dispatch off
    try {
      const { rows, total } = await waiting();
      expect(rows.find((r) => r.id === b.id)).toMatchObject({ settled: false, reason_code: 'SOLO_OFF' });
      expect(total).toBe(rows.filter((r) => !r.settled).length);
      expect(rows.filter((r) => r.settled).every((r) => r.reason_code === null)).toBe(true);
    } finally {
      await setSolo(true);
    }
  });

  it('the preview names what is allowed and by whom, and carries no figure', async () => {
    const b = await calledToday('LHR-7160', 'CALLED');
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER', 'LEAVE_CHARGE_OFF'])).statusCode).toBe(200);
    const solo = data(await preview(b.id, operatorToken)).solo;
    expect(Object.keys(solo).sort()).toEqual(['allowed', 'allowed_at', 'allowed_by_name', 'allows', 'credit_available']);
    expect(solo).toMatchObject({ allowed: true, credit_available: false, allows: ['CHEQUE_OR_TRANSFER', 'LEAVE_CHARGE_OFF'] });
    expect(solo.allowed_by_name).toBe((await managerRow()).name);
  });

  it('an allowance taken back while the checkout waits for the row is checked again under the lock', async () => {
    const b = await calledToday('LHR-7180');
    const total = data(await preview(b.id, operatorToken)).total_pkr as number;
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);

    let release!: () => void;
    let holding!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const isHolding = new Promise<void>((r) => (holding = r));
    // Hold the row: the checkout passes its pre-check (the allowance is live) and then waits for the lock. While it
    // waits, the allowance is taken back and committed, as another manager's request would.
    const blocker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM outbound_events WHERE id = ${b.id}::uuid FOR UPDATE`;
        holding();
        await hold;
        await tx.$executeRaw`UPDATE outbound_events SET manager_allows = ARRAY[]::varchar[], manager_allowed_at = NULL, manager_allowed_by = NULL WHERE id = ${b.id}::uuid`;
      },
      { timeout: 30_000 },
    );
    await isHolding;
    const checking = checkout(b.id, cheque(total), operatorToken);
    await new Promise((r) => setTimeout(r, 700));
    release();
    await blocker;

    refused(await checking, 'PAYMENT_MODE');
    await untouched(b.lotId, b.id, 100, 'PENDING');
    expect(await prisma.payment.count({ where: { partyId } })).toBe(0);
  });

  it('the desk list carries what is allowed, today only', async () => {
    const b = await calledToday('LHR-7170');
    expect((await allow([b.id], ['CHEQUE_OR_TRANSFER'])).statusCode).toBe(200);
    const queue = async () =>
      data<Allowed[]>(
        await app.inject({ method: 'GET', url: '/v1/outbound-events?status=PENDING,WEIGHED', headers: authHeaders(operatorToken) }),
      ).find((r) => r.id === b.id)!;
    expect((await queue()).allows).toEqual(['CHEQUE_OR_TRANSFER']);
    await prisma.outboundEvent.update({ where: { id: b.id }, data: { managerAllowedAt: longAgo(2) } });
    expect((await queue()).allows).toEqual([]);
  });
});
