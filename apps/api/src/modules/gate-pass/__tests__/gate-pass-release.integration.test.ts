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
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;
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
    expect(JSON.parse(out.body).error.message).toMatch(/Payment Pending/);
  });

  it('matches by dispatch time: a load dispatched last evening matches, one from three days ago does not', async () => {
    const recent = await dispatched(40, 'LHR-7001');
    await pay(recent.invoiceId);
    await prisma.outboundEvent.update({
      where: { id: recent.id },
      data: { finalizedAt: new Date(Date.now() - 20 * 3_600_000) },
    });
    const passA = await arrive('LHR-7001');
    const ok = await release(passA, { declared_quantity: 40 });
    expect(ok.statusCode).toBe(200);
    expect(data(ok).outbound_ids).toEqual([recent.id]);

    const old = await dispatched(30, 'LHR-7002');
    await pay(old.invoiceId);
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    await prisma.outboundEvent.update({
      where: { id: old.id },
      data: { finalizedAt: threeDaysAgo, createdAt: threeDaysAgo },
    });
    const passB = await arrive('LHR-7002');
    const loaded = await release(passB, { declared_quantity: 30 });
    expect(loaded.statusCode).toBe(422);
    expect(code(loaded)).toBe('GATE_OUTWARD_UNMATCHED_LOAD');
    // An empty truck (count 0) still leaves freely.
    const empty = await release(passB, { declared_quantity: 0 });
    expect(empty.statusCode).toBe(200);
    expect(data(empty).outbound_ids).toEqual([]);
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
    expect(body.authorized_quantity).toBe(50);
    expect([...body.outbound_ids].sort()).toEqual([a.id, b.id].sort());
    const rows = await prisma.outboundEvent.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(rows.every((r) => r.gatePassId === pass)).toBe(true);
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

    const byId = await release(second, { outbound_event_id: ob.id, declared_quantity: 40 });
    expect([byId.statusCode, code(byId)]).toEqual([409, 'GATE_OUTWARD_ALREADY_USED']);

    const logged = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/outward',
      headers: authHeaders(securityToken),
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
  });
});

describe('a named withdrawal', () => {
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
    const res = await release(pass, { outbound_event_id: pending, declared_quantity: 10 });
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_NOT_DISPATCHED']);
  });

  it('must be booked on this truck — or carry no plate at all — unless a manager gives a reason', async () => {
    const other = await dispatched(15, 'LHR-6400');
    await pay(other.invoiceId);
    const noPlate = await dispatched(12, null);
    await pay(noPlate.invoiceId);
    const pass = await arrive('ISB-1234');

    const mismatch = await release(pass, { outbound_event_id: other.id, declared_quantity: 15 });
    expect([mismatch.statusCode, code(mismatch)]).toEqual([422, 'GATE_OUTWARD_PLATE_MISMATCH']);
    const blank = await release(pass, { outbound_event_id: noPlate.id, declared_quantity: 12 });
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
