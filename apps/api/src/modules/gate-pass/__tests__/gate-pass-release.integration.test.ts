/**
 * Gate release rules (fast-dispatch Phase 0). A truck leaves only when every
 * withdrawal on it is dispatched, billed on a final invoice and paid — pending
 * cheques are not paid — or a manager records a credit authorization; the guard's
 * blind count matches; and nobody releases a truck they booked or dispatched.
 * Before this, a failed plate match let a loaded truck out unchecked and one paid
 * withdrawal could clear any number of trucks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { openLoads } from '../open-load';

vi.mock('../../pdf/pdf.service', () => ({
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
let securityUserId: string;
let accountantToken: string;
let partyId: string;

type Res = { statusCode: number; body: string };
const code = (r: Res) => JSON.parse(r.body).error?.code as string | undefined;
type PassBody = {
  outbound_ids: string[];
  cleared_by: string | null;
  override_reason: string | null;
  quantity_mismatch_flag: boolean;
  authorized_quantity: number | null;
  credit_authorized_by: string | null;
};
const data = <T = PassBody>(r: Res) => JSON.parse(r.body).data as T;

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

async function createLot(quantity: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: quantity,
      accepted_weight_kg: quantity * 20,
      inbound_date: '2026-04-10',
    },
  });
  expect(res.statusCode).toBe(201);
  return data<{ id: string }>(res).id;
}

/** Book, weigh and dispatch a FULL withdrawal of a fresh lot, booked on `plate`. */
async function dispatched(quantity: number, plate: string | null) {
  const lotId = await createLot(quantity);
  const create = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: quantity,
      outbound_date: '2026-09-01',
      ...(plate ? { vehicle_number: plate } : {}),
    },
  });
  expect(create.statusCode).toBe(201);
  const id = data<{ id: string }>(create).id;
  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${id}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: quantity * 19.5 },
  });
  const fin = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${id}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  return { id, invoiceId: data<{ invoice_id: string }>(fin).invoice_id };
}

async function finalizeInvoice(invoiceId: string): Promise<number> {
  const fin = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${invoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  return Number(data<{ total_pkr: string }>(fin).total_pkr);
}

async function pay(invoiceId: string, method: 'CASH' | 'CHEQUE' = 'CASH', finalized = false): Promise<string> {
  const total = finalized
    ? Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).totalPkr)
    : await finalizeInvoice(invoiceId);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(accountantToken),
    payload: {
      party_id: partyId,
      payment_date: '2026-09-01',
      amount_pkr: total,
      payment_method: method,
      ...(method === 'CHEQUE' ? { reference_number: 'MCB-1', cheque_date: '2026-09-01' } : {}),
      allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: total }],
    },
  });
  expect(res.statusCode).toBe(201);
  return data<{ id: string }>(res).id;
}

async function arrive(plate: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/gate-passes/inward',
    headers: authHeaders(securityToken),
    payload: { vehicle_number: plate },
  });
  expect(res.statusCode).toBe(201);
  return data<{ id: string }>(res).id;
}

/** Book a FULL withdrawal of a fresh lot on `plate`, left booked: not weighed, not dispatched. */
async function book(quantity: number, plate: string): Promise<string> {
  const lotId = await createLot(quantity);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: quantity, outbound_date: '2026-09-01', vehicle_number: plate },
  });
  expect(res.statusCode, res.body).toBe(201);
  return data<{ id: string }>(res).id;
}

function release(passId: string, body: Record<string, unknown>, token = securityToken) {
  return app.inject({
    method: 'POST',
    url: `/v1/gate-passes/${passId}/outward`,
    headers: authHeaders(token),
    payload: body,
  });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  const security = await loginAsRole(app, 'SECURITY');
  securityToken = security.accessToken;
  securityUserId = security.user.id;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: `Gate-Release-${Date.now()}`, party_type: 'FARMER', phone_primary: '03019380001' },
  });
  expect(party.statusCode).toBe(201);
  partyId = data<{ id: string }>(party).id;
}, 30_000);

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

describe('matching the truck to its withdrawals', () => {
  it('matches a plate however it was typed, and an unpaid load is held', async () => {
    const ob = await dispatched(50, 'lhr 4521'); // stored 'LHR 4521'
    await finalizeInvoice(ob.invoiceId);
    const pass = await arrive('LHR-4521');

    const out = await release(pass, { declared_quantity: 50 });
    expect(out.statusCode).toBe(422);
    expect(code(out)).toBe('GATE_OUTWARD_BLOCKED');
    // A guard hears "Payment pending — send the driver to the desk" (no amount); others hear the balance.
    expect(JSON.parse(out.body).error.message).toMatch(/payment pending/i);
  });

  it('a load dispatched days ago is still on the truck until it leaves; one dispatched before these rules is not matched', async () => {
    // Dispatched three days ago — the truck waited for a cheque — and not gone yet.
    const waited = await dispatched(40, 'LHR-7001');
    await pay(waited.invoiceId);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await prisma.outboundEvent.update({
      where: { id: waited.id },
      data: { finalizedAt: threeDaysAgo, createdAt: threeDaysAgo },
    });
    const passA = await arrive('LHR-7001');
    const ok = await release(passA, { declared_quantity: 40 });
    expect(ok.statusCode).toBe(200);
    expect(data(ok).outbound_ids).toEqual([waited.id]);

    // Dispatched before this release (no finalized_at): it may have left untracked,
    // so it never rides along on a later truck by plate.
    const legacy = await dispatched(30, 'LHR-7002');
    await pay(legacy.invoiceId);
    await prisma.outboundEvent.update({ where: { id: legacy.id }, data: { finalizedAt: null } });
    const passB = await arrive('LHR-7002');
    const loaded = await release(passB, { declared_quantity: 30 });
    expect(loaded.statusCode).toBe(422);
    expect(code(loaded)).toBe('GATE_OUTWARD_UNMATCHED_LOAD');
    // A manager can still name it explicitly.
    const named = await release(passB, { outbound_event_id: legacy.id, declared_quantity: 30 }, managerToken);
    expect(named.statusCode).toBe(200);
    expect(data(named).outbound_ids).toEqual([legacy.id]);
  });

  it('an empty truck leaving does not erase the count it came in with', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-7003', declared_quantity: 60 },
    });
    const passId = data<{ id: string }>(res).id;
    const lotId = await createLot(50);
    const link = await app.inject({
      method: 'PATCH',
      url: `/v1/gate-passes/${passId}/link-lot`,
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId },
    });
    expect(data(link).quantity_mismatch_flag).toBe(true);

    const out = await release(passId, { declared_quantity: 0 });
    expect(out.statusCode).toBe(200);
    const body = data<PassBody & { declared_quantity: number }>(out);
    expect(body.declared_quantity).toBe(60);
    expect(body.quantity_mismatch_flag).toBe(true);
  });

  it('an empty truck leaves with a count of 0, or with no count at all (older clients)', async () => {
    const a = await arrive('LHR-0001');
    expect((await release(a, { declared_quantity: 0 })).statusCode).toBe(200);
    const b = await arrive('LHR-0002');
    const res = await release(b, {});
    expect(res.statusCode).toBe(200);
    expect(data(res).cleared_by).toBeTruthy();
  });

  it('a loaded truck that matches no withdrawal is held; a manager may release it with a reason', async () => {
    const pass = await arrive('LHR-0009');
    const held = await release(pass, { declared_quantity: 25 });
    expect([held.statusCode, code(held)]).toEqual([422, 'GATE_OUTWARD_UNMATCHED_LOAD']);
    const ok = await release(pass, { declared_quantity: 25, override_reason: 'returned empty crates, checked' }, managerToken);
    expect(ok.statusCode).toBe(200);
    expect(data(ok).quantity_mismatch_flag).toBe(true);
    expect(data(ok).override_reason).toBe('returned empty crates, checked');
  });

  it('one truck carrying two lots: both are checked, both are attached, the count is their sum', async () => {
    const a = await dispatched(30, 'LHR-8800');
    const b = await dispatched(20, 'lhr8800');
    await pay(a.invoiceId);
    await finalizeInvoice(b.invoiceId);
    const pass = await arrive('LHR 8800');

    // One of the two is billed but unpaid: the truck is held.
    const held = await release(pass, { declared_quantity: 50 });
    expect([held.statusCode, code(held)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);

    await pay(b.invoiceId, 'CASH', true);
    const wrongCount = await release(pass, { declared_quantity: 30 });
    expect([wrongCount.statusCode, code(wrongCount)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH']);

    const out = await release(pass, { declared_quantity: 50 });
    expect(out.statusCode).toBe(200);
    const body = data(out);
    // The guard is not told what it was checked against; a manager reads the sum.
    expect(body.authorized_quantity).toBeNull();
    const asManager = await app.inject({ method: 'GET', url: `/v1/gate-passes/${pass}`, headers: authHeaders(managerToken) });
    expect(data(asManager).authorized_quantity).toBe(50);
    expect([...body.outbound_ids].sort()).toEqual([a.id, b.id].sort());
    const rows = await prisma.outboundEvent.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.gatePassId === pass)).toBe(true);
  });
});

// C3 D3: the gate used to match only dispatched withdrawals, so a truck whose load was booked but not yet
// checked out left on a count of 0. Anything still open on the plate holds the truck — even for a manager,
// because the fix is at the desk (check it out, or cancel it), not at the gate.
describe('a truck still being loaded cannot leave', () => {
  const dnOfRow = async (id: string) => (await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).dispatchNoteNumber!;

  it('holds a truck whose plate carries a booked withdrawal, even on a count of 0', async () => {
    const booked = await book(20, 'LHR-9101');
    const pass = await arrive('LHR-9101');

    const out = await release(pass, { declared_quantity: 0 });
    expect([out.statusCode, code(out)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
    expect(JSON.parse(out.body).error.message).toContain(await dnOfRow(booked));
    expect((await prisma.gatePass.findUniqueOrThrow({ where: { id: pass } })).status).toBe('ARRIVED');
  });

  it('holds a truck carrying one dispatched and one weighed line', async () => {
    const sent = await dispatched(20, 'LHR-9102');
    await pay(sent.invoiceId);
    const weighed = await book(15, 'LHR-9102');
    const weigh = await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${weighed}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 15 * 19.5 },
    });
    expect(weigh.statusCode, weigh.body).toBe(200);
    const pass = await arrive('LHR-9102');

    // The dispatched line's own count would have let the truck out with the weighed one still to load.
    const out = await release(pass, { declared_quantity: 20 });
    expect([out.statusCode, code(out)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
    const message = JSON.parse(out.body).error.message as string;
    expect(message).toContain(await dnOfRow(weighed));
    expect(message).not.toContain(await dnOfRow(sent.id));
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: sent.id } })).gatePassId).toBeNull();
  });

  it('an override reason does not release a booked line', async () => {
    await book(20, 'LHR-9104');
    const pass = await arrive('LHR-9104');
    const out = await release(pass, { declared_quantity: 0, override_reason: 'driver is waiting, checked by hand' }, managerToken);
    expect([out.statusCode, code(out)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
  });

  it('naming a withdrawal does not skip a booked line on the truck', async () => {
    const sent = await dispatched(20, 'LHR-9105');
    await pay(sent.invoiceId);
    const booked = await book(15, 'LHR-9105');
    const pass = await arrive('LHR-9105');

    const out = await release(pass, { outbound_event_id: sent.id, declared_quantity: 20 }, managerToken);
    expect([out.statusCode, code(out)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
    expect(JSON.parse(out.body).error.message).toContain(await dnOfRow(booked));
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: sent.id } })).gatePassId).toBeNull();
  });

  it('a cancelled booking does not hold the truck', async () => {
    const booked = await book(20, 'LHR-9106');
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${booked}/cancel`,
      headers: authHeaders(operatorToken),
      payload: { reason: 'Party changed its mind' },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    const pass = await arrive('LHR-9106');
    expect((await release(pass, { declared_quantity: 0 })).statusCode).toBe(200);
  });

  it('a withdrawal dispatched before these rules neither holds nor counts', async () => {
    const legacy = await dispatched(10, 'LHR-9103');
    await prisma.outboundEvent.update({ where: { id: legacy.id }, data: { finalizedAt: null } });
    const pass = await arrive('LHR-9103');

    expect((await release(pass, { declared_quantity: 0 })).statusCode).toBe(200);
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: legacy.id } })).gatePassId).toBeNull();
  });
});

// C3 D4: a guard used to retype the count until it matched, and nothing recorded the tries. Every wrong
// count is now saved, and a truck that has had three of them since its last release is a manager's.
describe('wrong counts are saved, and three of them lock the truck', () => {
  const miss = (pass: string, bags: number, token = securityToken) => release(pass, { declared_quantity: bags }, token);
  const triesLeft = (r: Res) => JSON.parse(r.body).error.details?.tries_left as number | undefined;
  const attempts = (where: Record<string, unknown>) => prisma.gateCountAttempt.count({ where });
  /** A paid 50-bag withdrawal dispatched on `plate`, and a truck of that plate at the gate. */
  const loaded = async (plate: string) => {
    const ob = await dispatched(50, plate);
    await pay(ob.invoiceId);
    return { ob, pass: await arrive(plate) };
  };

  it('saves each wrong count: the number typed, the number expected, who typed it', async () => {
    const { pass } = await loaded('LHR-9201');
    const out = await miss(pass, 45);
    expect([out.statusCode, code(out)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH']);
    expect(JSON.parse(out.body).error.details).toEqual({ tries_left: 2 });

    const rows = await prisma.gateCountAttempt.findMany({ where: { gatePassId: pass } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plate: 'LHR9201', declaredQuantity: 45, expectedQuantity: 50, createdBy: securityUserId });
    // The refusal left the truck where it was.
    expect((await prisma.gatePass.findUniqueOrThrow({ where: { id: pass } })).status).toBe('ARRIVED');
  });

  it('after three wrong counts the guard is refused even with the right number; a manager still releases', async () => {
    const { ob, pass } = await loaded('LHR-9203');
    for (const [i, bags] of [41, 42, 43].entries()) {
      const r = await miss(pass, bags);
      expect([r.statusCode, code(r), triesLeft(r)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH', 2 - i]);
    }
    const locked = await miss(pass, 50);
    expect([locked.statusCode, code(locked)]).toEqual([403, 'GATE_OUTWARD_COUNT_LOCKED']);
    expect(locked.body).not.toMatch(/\b50\b/);
    expect(await attempts({ gatePassId: pass })).toBe(3); // the refusal saved nothing

    const ok = await miss(pass, 50, managerToken);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(data(ok).outbound_ids).toEqual([ob.id]);
  });

  it('logging the truck again does not give the guard fresh tries', async () => {
    const { pass: first } = await loaded('LHR-9204');
    for (const bags of [41, 42, 43]) await miss(first, bags);
    const second = await arrive('LHR-9204');
    const locked = await miss(second, 50);
    expect([locked.statusCode, code(locked)]).toEqual([403, 'GATE_OUTWARD_COUNT_LOCKED']);
  });

  it('tries start again once the truck has been released', async () => {
    const { pass: first } = await loaded('LHR-9205');
    await miss(first, 41);
    await miss(first, 42);
    expect((await miss(first, 50, managerToken)).statusCode).toBe(200);

    const next = await dispatched(30, 'LHR-9205');
    await pay(next.invoiceId);
    const second = await arrive('LHR-9205');
    const again = await miss(second, 20);
    expect([again.statusCode, code(again), triesLeft(again)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH', 2]);
  });

  it('a count on a truck nothing was dispatched for is a wrong count too', async () => {
    const pass = await arrive('LHR-9206');
    const out = await miss(pass, 5);
    expect([out.statusCode, code(out), triesLeft(out)]).toEqual([422, 'GATE_OUTWARD_UNMATCHED_LOAD', 2]);
    expect(await prisma.gateCountAttempt.findFirstOrThrow({ where: { gatePassId: pass } })).toMatchObject({
      declaredQuantity: 5,
      expectedQuantity: 0,
    });
  });

  it('a refusal that is not about the count uses no try', async () => {
    const unpaid = await dispatched(20, 'LHR-9207');
    await finalizeInvoice(unpaid.invoiceId);
    const pass = await arrive('LHR-9207');
    expect(code(await miss(pass, 20))).toBe('GATE_OUTWARD_BLOCKED');

    await book(10, 'LHR-9207'); // a booked line now holds the truck (D3)
    expect(code(await miss(pass, 20))).toBe('GATE_OUTWARD_NOT_DISPATCHED');
    expect(await attempts({ gatePassId: pass })).toBe(0);
  });

  it("a manager's wrong counts are saved too, but a manager is never locked", async () => {
    const { pass } = await loaded('LHR-9209');
    const lefts: (number | undefined)[] = [];
    for (const bags of [41, 42, 43, 44]) {
      const r = await miss(pass, bags, managerToken);
      expect([r.statusCode, code(r)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH']);
      lefts.push(triesLeft(r));
    }
    expect(lefts).toEqual([2, 1, 0, 0]);
    expect(await attempts({ gatePassId: pass })).toBe(4);
    expect((await miss(pass, 50, managerToken)).statusCode).toBe(200);
  });

  it('a refused one-step log-and-release keeps its pass and its try, and is not tied to the withdrawal named', async () => {
    const named = await dispatched(50, 'LHR-9208');
    await pay(named.invoiceId);
    const unpaid = await dispatched(30, 'LHR-9208'); // the same truck, billed and not paid
    await finalizeInvoice(unpaid.invoiceId);

    const logged = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/outward',
      headers: authHeaders(managerToken),
      payload: { vehicle_number: 'LHR-9208', outbound_event_id: named.id, declared_quantity: 45 },
    });
    expect([logged.statusCode, code(logged)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH']);
    const passes = await prisma.gatePass.findMany({ where: { facilityId: TEST_FACILITY_ID, vehicleNumber: 'LHR-9208' } });
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ status: 'ARRIVED', relatedOutboundId: null });
    expect(await attempts({ gatePassId: passes[0]!.id })).toBe(1);
    const rows = await prisma.outboundEvent.findMany({ where: { id: { in: [named.id, unpaid.id] } } });
    expect(rows.every((o) => o.gatePassId === null)).toBe(true);

    // The pass does not remember the withdrawal the manager named: a guard's release still checks the
    // whole truck by plate, so the unpaid one holds it. (A stored link let a guard release just the paid one.)
    const bare = await release(passes[0]!.id, { declared_quantity: 50 });
    expect([bare.statusCode, code(bare)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
  });

  it('two passes of one plate cannot both take the last try', async () => {
    // A truck with nothing dispatched for it holds no withdrawal row to serialize on, so the plate's own
    // lock is all that stops two guards reading "2 used" at once. Three rounds, as the load race does: one
    // lucky ordering must not pass a lock that is not there.
    for (let round = 0; round < 3; round++) {
      const plate = `LHR-92${round}0`;
      const [a, b] = [await arrive(plate), await arrive(plate)];
      await miss(a, 5);
      await miss(a, 6);

      const [ra, rb] = await Promise.all([miss(a, 7), miss(b, 8)]);
      expect([ra.statusCode, rb.statusCode].sort()).toEqual([403, 422]);
      expect(await attempts({ facilityId: TEST_FACILITY_ID, plate: `LHR92${round}0` })).toBe(3);
    }
  }, 45_000);

  it('Ready to leave tells the guard a locked truck is locked, and still lists it as ready for a manager', async () => {
    const { pass } = await loaded('LHR-9212');
    for (const bags of [41, 42, 43]) await miss(pass, bags);
    const state = async (token: string) =>
      data<{ id: string; release: { state: string } }[]>(
        await app.inject({ method: 'GET', url: '/v1/gate-passes?active=true', headers: authHeaders(token) }),
      ).find((p) => p.id === pass)!.release.state;
    expect(await state(securityToken)).toBe('COUNT_LOCKED');
    expect(await state(managerToken)).toBe('READY');
  });

  it('a count too large to store is a plain refusal, not a server error', async () => {
    const { pass } = await loaded('LHR-9213');
    const res = await miss(pass, 3_000_000_000);
    expect([res.statusCode, code(res)]).toEqual([400, 'VALIDATION_ERROR']);
    expect(await attempts({ gatePassId: pass })).toBe(0);
  });

  it('the pass lists its wrong counts: the guard sees none, a manager sees what was typed and expected', async () => {
    const { pass } = await loaded('LHR-9211');
    await miss(pass, 44);
    type Attempts = { count_attempts: Record<string, unknown>[] };
    const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: authHeaders(token) });

    // The guard gets none of it: a manager's or another guard's wrong count sits near the truth.
    const guard = data<{ count_attempts: unknown }>(await get(`/v1/gate-passes/${pass}`, securityToken));
    expect(guard).toHaveProperty('count_attempts', null);
    const manager = data<Attempts>(await get(`/v1/gate-passes/${pass}`, managerToken));
    expect(manager.count_attempts[0]).toMatchObject({ declared_quantity: 44, expected_quantity: 50 });
    expect(manager.count_attempts[0]!['counted_by_name']).toBeTruthy();

    // The gate page reads them from the list of trucks inside.
    const listed = data<(Attempts & { id: string })[]>(await get('/v1/gate-passes?active=true', managerToken));
    expect(listed.find((p) => p.id === pass)?.count_attempts).toHaveLength(1);
  });
});

describe('a withdrawal leaves on one truck only', () => {
  it('once released, it cannot clear a second truck — by plate, by explicit id, or through POST /outward', async () => {
    const ob = await dispatched(40, 'LHR-6100');
    await pay(ob.invoiceId);
    const first = await arrive('LHR-6100');
    expect((await release(first, { declared_quantity: 40 })).statusCode).toBe(200);

    // Same plate again: nothing left to match, so a counted load is held.
    const second = await arrive('LHR-6100');
    const byPlate = await release(second, { declared_quantity: 40 });
    expect([byPlate.statusCode, code(byPlate)]).toEqual([422, 'GATE_OUTWARD_UNMATCHED_LOAD']);

    const byId = await release(second, { outbound_event_id: ob.id, declared_quantity: 40 }, managerToken);
    expect([byId.statusCode, code(byId)]).toEqual([409, 'GATE_OUTWARD_ALREADY_USED']);

    const logged = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/outward',
      headers: authHeaders(managerToken),
      payload: { vehicle_number: 'LHR-6100', outbound_event_id: ob.id, declared_quantity: 40 },
    });
    expect([logged.statusCode, code(logged)]).toEqual([409, 'GATE_OUTWARD_ALREADY_USED']);
  });

  it('two trucks with the same plate released at once: exactly one takes the load', async () => {
    for (let round = 0; round < 3; round++) {
      const plate = `LHR-62${round}0`;
      const ob = await dispatched(35, plate);
      await pay(ob.invoiceId);
      const [p1, p2] = [await arrive(plate), await arrive(plate)];
      const [a, b] = await Promise.all([
        release(p1, { declared_quantity: 35 }),
        release(p2, { declared_quantity: 35 }),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 422]);
      const loser = [a, b].find((r) => r.statusCode === 422)!;
      expect(code(loser)).toBe('GATE_OUTWARD_UNMATCHED_LOAD');
      const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: ob.id } });
      expect([p1, p2]).toContain(row.gatePassId);
      await cleanup();
    }
    // Three full rounds of dispatch, pay, arrive and a racing release: on a loaded machine that
    // outruns the 15 s default, and a test killed mid-round leaves its truck for the next test.
  }, 45_000);
});

describe('a named withdrawal', () => {
  it('only a manager may name one — a guard or the munshi cannot pick which load is checked', async () => {
    const paid = await dispatched(10, 'LHR-6250');
    await pay(paid.invoiceId);
    await dispatched(15, 'LHR-6250'); // unpaid, same truck
    const pass = await arrive('LHR-6250');
    for (const token of [securityToken, operatorToken]) {
      const res = await release(pass, { outbound_event_id: paid.id, declared_quantity: 10 }, token);
      expect([res.statusCode, code(res)]).toEqual([403, 'GATE_OVERRIDE_REQUIRES_MANAGER']);
    }
    // By plate, both loads are checked, and the unpaid one holds the truck.
    const byPlate = await release(pass, { declared_quantity: 25 });
    expect([byPlate.statusCode, code(byPlate)]).toEqual([422, 'GATE_OUTWARD_INVOICE_NOT_FINAL']);
  });

  it('must be dispatched', async () => {
    const lotId = await createLot(10);
    const create = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 10, outbound_date: '2026-09-01', vehicle_number: 'LHR-6300' },
    });
    const pending = data<{ id: string }>(create).id;
    const pass = await arrive('LHR-6300');
    const res = await release(pass, { outbound_event_id: pending, declared_quantity: 10 }, managerToken);
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
  });

  it('must be booked on this truck — or carry no plate at all — unless a manager gives a reason', async () => {
    const other = await dispatched(15, 'LHR-6400');
    await pay(other.invoiceId);
    const noPlate = await dispatched(12, null);
    await pay(noPlate.invoiceId);
    const pass = await arrive('ISB-1234');

    const mismatch = await release(pass, { outbound_event_id: other.id, declared_quantity: 15 }, managerToken);
    expect([mismatch.statusCode, code(mismatch)]).toEqual([422, 'GATE_OUTWARD_PLATE_MISMATCH']);
    const blank = await release(pass, { outbound_event_id: noPlate.id, declared_quantity: 12 }, managerToken);
    expect([blank.statusCode, code(blank)]).toEqual([422, 'GATE_OUTWARD_PLATE_MISMATCH']);

    const ok = await release(
      pass,
      { outbound_event_id: other.id, declared_quantity: 15, override_reason: 'truck swapped after breakdown' },
      managerToken,
    );
    expect(ok.statusCode).toBe(200);
    expect(data(ok).override_reason).toBe('truck swapped after breakdown');
  });
});

describe('payment at the gate', () => {
  it('a cheque is not payment until it clears', async () => {
    const ob = await dispatched(25, 'LHR-6500');
    const paymentId = await pay(ob.invoiceId, 'CHEQUE');
    const pass = await arrive('LHR-6500');

    const held = await release(pass, { declared_quantity: 25 });
    expect([held.statusCode, code(held)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
    expect(JSON.parse(held.body).error.message).toMatch(/cheques not yet cleared/);

    const cleared = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/clear`,
      headers: authHeaders(accountantToken),
      payload: { clear_date: '2026-09-02' },
    });
    expect(cleared.statusCode).toBe(200);
    expect((await release(pass, { declared_quantity: 25 })).statusCode).toBe(200);
  });

  it('nothing leaves on a draft bill — not even on credit', async () => {
    await dispatched(20, 'LHR-6600'); // invoice left DRAFT
    const pass = await arrive('LHR-6600');
    const res = await release(pass, { declared_quantity: 20, credit_authorization: true }, managerToken);
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_INVOICE_NOT_FINAL']);
  });

  it('a voided bill can never be re-issued, so the stock leaves only on a recorded manager credit authorization', async () => {
    const ob = await dispatched(18, 'LHR-6700');
    await finalizeInvoice(ob.invoiceId);
    const voided = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${ob.invoiceId}/void`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'billed the wrong party' },
    });
    expect(voided.statusCode).toBe(200);
    const pass = await arrive('LHR-6700');

    const held = await release(pass, { declared_quantity: 18 });
    expect([held.statusCode, code(held)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
    expect(JSON.parse(held.body).error.message).toMatch(/no valid bill/);

    const ok = await release(pass, { declared_quantity: 18, credit_authorization: true }, managerToken);
    expect(ok.statusCode).toBe(200);
    expect(data(ok).credit_authorized_by).toBeTruthy();
    // Nothing was billed, so the amount on credit is unknown — never a misleading Rs 0.
    expect(data<PassBody & { credit_authorized_amount_pkr: number | null }>(ok).credit_authorized_amount_pkr).toBeNull();
  });

  it('a guard refused for payment hears that it is pending, never how much; a manager hears the balance', async () => {
    const ob = await dispatched(24, 'LHR-6900');
    await finalizeInvoice(ob.invoiceId);
    const pass = await arrive('LHR-6900');
    const guard = await release(pass, { declared_quantity: 24 });
    expect([guard.statusCode, code(guard)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
    // The fact only, and no amount: the gate page gives the guard the next step (escalate).
    expect(JSON.parse(guard.body).error.message).toBe('Payment pending');
    const manager = await release(pass, { declared_quantity: 24 }, managerToken);
    expect([manager.statusCode, code(manager)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
    expect(JSON.parse(manager.body).error.message).toMatch(/^Payment Pending — balance \d+\.\d{2} PKR$/);
  });

  it('the amount a manager released on credit is on the pass for managers, and not for the guard', async () => {
    const ob = await dispatched(22, 'LHR-6800');
    await finalizeInvoice(ob.invoiceId);
    const pass = await arrive('LHR-6800');
    const ok = await release(pass, { declared_quantity: 22, credit_authorization: true }, managerToken);
    expect(ok.statusCode, ok.body).toBe(200);
    const read = async (token: string) =>
      data<PassBody & { credit_authorized_amount_pkr: number | null }>(
        await app.inject({ method: 'GET', url: `/v1/gate-passes/${pass}`, headers: authHeaders(token) }),
      ).credit_authorized_amount_pkr;
    expect(await read(managerToken)).toBeGreaterThan(0);
    expect(await read(securityToken)).toBeNull();
  });
});

describe('the guard and the count', () => {
  it('a loaded truck needs a count before it leaves', async () => {
    const ob = await dispatched(22, 'LHR-6800');
    await pay(ob.invoiceId);
    const pass = await arrive('LHR-6800');
    const res = await release(pass, {});
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_COUNT_REQUIRED']);
    expect((await release(pass, { declared_quantity: 22 })).statusCode).toBe(200);
  });

  it('whoever booked a withdrawal cannot release its truck; a manager can', async () => {
    const ob = await dispatched(16, 'LHR-6900'); // booked by the OPERATOR
    await pay(ob.invoiceId);
    const pass = await arrive('LHR-6900');

    const self = await release(pass, { declared_quantity: 16 }, operatorToken);
    expect([self.statusCode, code(self)]).toEqual([403, 'GATE_SELF_RELEASE']);

    // The MANAGER dispatched it, but MANAGER+ is exempt.
    const mgr = await release(pass, { declared_quantity: 16 }, managerToken);
    expect(mgr.statusCode).toBe(200);
  });
});

describe('release preview on the active list (what the gate console shows before the guard taps)', () => {
  const activeRelease = async (passId: string, token = securityToken) => {
    const res = await app.inject({ method: 'GET', url: '/v1/gate-passes?active=true&page_size=100', headers: authHeaders(token) });
    expect(res.statusCode).toBe(200);
    const row = (JSON.parse(res.body).data as { id: string; release: Record<string, unknown> }[]).find((r) => r.id === passId);
    expect(row, 'pass is on the active list').toBeDefined();
    return row!.release as {
      state: string;
      dispatch_notes: string[];
      outstanding_pkr: number | null;
      cheque_pending: boolean;
      marka: string | null;
      owner_party_name: string | null;
      withdrawals?: Record<string, unknown>[];
    };
  };

  it('walks a truck from nothing booked to ready, and what it says is what the release then enforces', async () => {
    const pass = await arrive('LHR-5500');
    expect((await activeRelease(pass)).state).toBe('NO_BOOKING');

    // Booked and weighed, not dispatched yet.
    const lotId = await createLot(30);
    const booked = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 30, outbound_date: '2026-09-01', vehicle_number: 'lhr 5500' },
    });
    expect(booked.statusCode).toBe(201);
    expect((await activeRelease(pass)).state).toBe('NOT_DISPATCHED');
    await prisma.outboundEvent.deleteMany({ where: { id: data<{ id: string }>(booked).id } });

    const ob = await dispatched(30, 'LHR-5500'); // dispatched, bill still a draft
    expect((await activeRelease(pass)).state).toBe('BILL_DRAFT');

    await finalizeInvoice(ob.invoiceId); // billed, unpaid
    const owed = await activeRelease(pass);
    expect(owed.state).toBe('PAYMENT_PENDING');
    // The guard is told a payment is pending, never how much: an amount stands in for the bag count.
    expect(owed.outstanding_pkr).toBeNull();
    expect((await activeRelease(pass, managerToken)).outstanding_pkr).toBeGreaterThan(0);
    expect(owed.dispatch_notes).toHaveLength(1);
    expect((await release(pass, { declared_quantity: 30 })).statusCode).toBe(422);

    await pay(ob.invoiceId, 'CASH', true);
    const ready = await activeRelease(pass);
    expect([ready.state, ready.outstanding_pkr]).toEqual(['READY', null]);
    expect((await activeRelease(pass, managerToken)).outstanding_pkr).toBe(0);
    expect((await release(pass, { declared_quantity: 30 })).statusCode).toBe(200);
  });

  it('counts an uncleared cheque as still owed, and says so', async () => {
    const ob = await dispatched(25, 'LHR-5501');
    await pay(ob.invoiceId, 'CHEQUE');
    const pass = await arrive('LHR-5501');
    const r = await activeRelease(pass);
    expect([r.state, r.cheque_pending]).toEqual(['PAYMENT_PENDING', true]);
    expect(r.outstanding_pkr).toBeNull();
    expect((await activeRelease(pass, managerToken)).outstanding_pkr).toBeGreaterThan(0);
  });

  it('carries the owner and marka for the guard to check, and never a bag count', async () => {
    const ob = await dispatched(20, 'LHR-5502');
    await pay(ob.invoiceId);
    const pass = await arrive('LHR-5502');
    const r = await activeRelease(pass);
    expect(r.state).toBe('READY');
    expect(r.owner_party_name).toBeTruthy();
    expect(Object.keys(r).sort()).toEqual(['cheque_pending', 'dispatch_notes', 'marka', 'outstanding_pkr', 'owner_party_name', 'state', 'withdrawals']);
    // Each withdrawal is named as the receipt names it — dispatch note, marka, owner — never with a count.
    for (const w of r.withdrawals ?? []) expect(Object.keys(w).sort()).toEqual(['dispatch_note_number', 'marka', 'owner_party_name']);
    expect(r.outstanding_pkr).toBeNull(); // the key stays (as null) so the page renders "not shown"
    // Nothing in the whole payload names the 20 bags that were dispatched.
    const res = await app.inject({ method: 'GET', url: '/v1/gate-passes?active=true', headers: authHeaders(securityToken) });
    expect(res.body).not.toMatch(/quantity_withdrawn|"quantity"/);
    // And no stock quantity or rack count in any row of it (the SECURITY role is redacted: common/blind-count.ts).
    for (const p of JSON.parse(res.body).data as { authorized_quantity?: number | null; related_location?: string | null }[]) {
      expect(p.authorized_quantity ?? null).toBeNull();
      expect(p.related_location ?? '').not.toMatch(/×/);
    }
  });

  it('only the active list carries it, and a withdrawal that already left no longer shows', async () => {
    const ob = await dispatched(15, 'LHR-5503');
    await pay(ob.invoiceId);
    const pass = await arrive('LHR-5503');
    expect((await activeRelease(pass)).state).toBe('READY');
    expect((await release(pass, { declared_quantity: 15 })).statusCode).toBe(200);

    const next = await arrive('LHR-5503');
    expect((await activeRelease(next)).state).toBe('NO_BOOKING');
    const byId = await app.inject({ method: 'GET', url: `/v1/gate-passes/${next}`, headers: authHeaders(securityToken) });
    expect(data(byId)).not.toHaveProperty('release');
  });
});

// One reading of what is on a truck, shared by the gate's Ready-to-leave preview and the dispatch desk.
describe('the open load on a truck (openLoads)', () => {
  it('holds what is booked or dispatched on the plate and has not left — however the plate was typed — and nothing else', async () => {
    const sent = await dispatched(20, 'LHR-6950');
    const booked = await book(15, 'lhr 6950');
    // Dispatched before these rules (no finalized_at): it may have left untracked, so it is on no truck.
    const legacy = await dispatched(10, 'LHR-6950');
    await prisma.outboundEvent.update({ where: { id: legacy.id }, data: { finalizedAt: null } });
    const otherTruck = await dispatched(12, 'LHR-6951');

    const loads = await openLoads(prisma, TEST_FACILITY_ID, ['LHR 6950']);
    expect([...loads.keys()]).toEqual(['LHR6950']);
    const ids = loads.get('LHR6950')!.map((l) => l.id);
    expect(ids.sort()).toEqual([sent.id, booked].sort());
    expect(ids).not.toContain(legacy.id);
    expect(ids).not.toContain(otherTruck.id);
    // Each line carries what the desk and the gate read: its stage, party, book and bill.
    const line = loads.get('LHR6950')!.find((l) => l.id === sent.id)!;
    expect(line).toMatchObject({ status: 'DISPATCHED', quantityWithdrawnBags: 20, lot: { bookType: 'PACCI' } });
    expect(line.lot.billingParty.id).toBe(partyId);
    expect(line.invoice?.id).toBe(sent.invoiceId);
  });

  it('a line leaves the load when its truck leaves the gate, or when it is cancelled', async () => {
    const ob = await dispatched(20, 'LHR-6960');
    await pay(ob.invoiceId);
    const cancelled = await book(5, 'LHR-6960');
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${cancelled}/cancel`,
      headers: authHeaders(operatorToken),
      payload: { reason: 'Party changed its mind' },
    });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect((await openLoads(prisma, TEST_FACILITY_ID, ['LHR-6960'])).get('LHR6960')!.map((l) => l.id)).toEqual([ob.id]);

    const pass = await arrive('LHR-6960');
    expect((await release(pass, { declared_quantity: 20 })).statusCode).toBe(200);
    expect((await openLoads(prisma, TEST_FACILITY_ID, ['LHR-6960'])).has('LHR6960')).toBe(false);
  });

  it('no plates asked, nothing read', async () => {
    expect((await openLoads(prisma, TEST_FACILITY_ID, [])).size).toBe(0);
    expect((await openLoads(prisma, TEST_FACILITY_ID, ['  -- '])).size).toBe(0);
  });
});
