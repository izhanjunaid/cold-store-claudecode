/**
 * Withdrawal integrity (fast-dispatch Phase 0): a lot's balance can neither go
 * negative nor lose an update, booked bags are held until dispatch or cancel, and a
 * withdrawal can be cancelled. Every race asserts the loser (CLAUDE.md): a
 * concurrency test that only counts successes stays green when the lock does nothing.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { withGuardsDisabled } from '../../test/financial-guards';
import { PrismaClient } from '@coldchain/db';
import { addDays, businessDate } from '@coldchain/shared';
import type { FastifyInstance } from 'fastify';

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
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';
const OUTBOUND_DATE = '2026-04-20';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let managerId: string;
let ownerPartyId: string;
let buyerPartyId: string;
const lots: string[] = [];
const parties: string[] = [];

type Res = { statusCode: number; body: string };
const code = (r: Res) => JSON.parse(r.body).error?.code as string | undefined;
const data = <T = Record<string, unknown>>(r: Res) => JSON.parse(r.body).data as T;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    if (lots.length === 0) return;
    // Partial transfers create child lots; they go too.
    const all = (
      await prisma.lot.findMany({
        where: { OR: [{ id: { in: lots } }, { parentLotId: { in: lots } }] },
        select: { id: true },
      })
    ).map((l) => l.id);
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { lotId: { in: all } } } });
    await prisma.invoice.deleteMany({ where: { lotId: { in: all } } });
    await prisma.outboundEvent.deleteMany({ where: { lotId: { in: all } } });
    await prisma.lotMovement.deleteMany({ where: { lotId: { in: all } } });
    await prisma.lotRackPlacement.deleteMany({ where: { lotId: { in: all } } });
    await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: all } } });
    await prisma.lot.deleteMany({ where: { parentLotId: { in: lots } } });
    await prisma.lot.deleteMany({ where: { id: { in: lots } } });
  });
  lots.length = 0;
}

async function party(name: string, phone: string, type = 'FARMER'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name, party_type: type, phone_primary: phone },
  });
  expect(res.statusCode).toBe(201);
  const id = data<{ id: string }>(res).id;
  parties.push(id);
  return id;
}

async function createLot(quantity = 100) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN,
      chamber_id: CHAMBER_A,
      quantity_bags: quantity,
      accepted_weight_kg: quantity * 20,
      inbound_date: '2026-04-01',
    },
  });
  expect(res.statusCode).toBe(201);
  const lot = data<{ id: string }>(res);
  lots.push(lot.id);
  return lot.id;
}

function book(lotId: string, qty: number, type: 'FULL' | 'PARTIAL' = 'PARTIAL', extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: { lot_id: lotId, withdrawal_type: type, quantity_withdrawn_bags: qty, outbound_date: OUTBOUND_DATE, ...extra },
  });
}

async function booked(lotId: string, qty: number, type: 'FULL' | 'PARTIAL' = 'PARTIAL') {
  const res = await book(lotId, qty, type);
  expect(res.statusCode).toBe(201);
  return data<{ id: string }>(res).id;
}

function weigh(id: string, kg = 1000) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${id}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: kg },
  });
}

function finalize(id: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${id}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
}

function cancel(id: string, token = operatorToken) {
  return app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${id}/cancel`,
    headers: authHeaders(token),
    payload: { reason: 'customer did not come' },
  });
}

const balanceOf = async (lotId: string) =>
  (await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags;

beforeAll(async () => {
  app = await getTestApp();
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  managerId = mgr.user.id;
  ownerPartyId = await party('Integrity Owner Farmer', '03009400001');
  buyerPartyId = await party('Integrity Buyer Trader', '03009400002', 'BUYER');
});

// Each test's lots go when it ends: the test room holds 1000 bags.
afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: { in: parties } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('dispatch: one decrement per withdrawal', () => {
  it('two concurrent finalizes of one withdrawal: one dispatches, the other gets 409 — balance drops once, one invoice', async () => {
    for (let round = 0; round < 3; round++) {
      const lotId = await createLot(100);
      const ob = await booked(lotId, 40);
      expect((await weigh(ob)).statusCode).toBe(200);

      const [a, b] = await Promise.all([finalize(ob), finalize(ob)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
      const loser = [a, b].find((r) => r.statusCode === 409)!;
      expect(code(loser)).toBe('OUTBOUND_ALREADY_FINALIZED');

      expect(await balanceOf(lotId)).toBe(60);
      expect(await prisma.invoice.count({ where: { outboundEventId: ob } })).toBe(1);
      const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: ob } });
      expect(row.status).toBe('DISPATCHED');
      expect(row.finalizedBy).toBe(managerId);
      expect(row.finalizedAt).toBeInstanceOf(Date);
    }
  });

  it('a weight entry racing finalize never puts a dispatched withdrawal back to WEIGHED', async () => {
    for (let round = 0; round < 3; round++) {
      const lotId = await createLot(100);
      const ob = await booked(lotId, 25);
      expect((await weigh(ob)).statusCode).toBe(200);

      const [w, f] = await Promise.all([weigh(ob, 1100), finalize(ob)]);
      expect(f.statusCode).toBe(200);
      // The weight either landed first (200) or found the withdrawal already gone (409).
      if (w.statusCode !== 200) {
        expect(w.statusCode).toBe(409);
        expect(code(w)).toBe('OUTBOUND_ALREADY_FINALIZED');
      }
      const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: ob } });
      expect(row.status).toBe('DISPATCHED');
      expect(await balanceOf(lotId)).toBe(75);
    }
  });

  it('finalize re-reads the lot under its lock: a stale FULL, a closed lot and a short balance are all refused', async () => {
    // These states cannot be reached through the API any more (bookings reserve
    // their bags); they stand for rows booked before the fix.
    const fullLot = await createLot(100);
    const full = await booked(fullLot, 100, 'FULL');
    await weigh(full);
    await prisma.lot.update({ where: { id: fullLot }, data: { currentBalanceBags: 80 } });
    const stale = await finalize(full);
    expect(stale.statusCode).toBe(409);
    expect(code(stale)).toBe('OUTBOUND_QUANTITY_STALE');
    expect(await balanceOf(fullLot)).toBe(80);

    const closedLot = await createLot(100);
    const onClosed = await booked(closedLot, 30);
    await weigh(onClosed);
    await prisma.lot.update({ where: { id: closedLot }, data: { status: 'CLOSED' } });
    const closed = await finalize(onClosed);
    expect(closed.statusCode).toBe(409);
    expect(code(closed)).toBe('LOT_NOT_ACTIVE');

    const shortLot = await createLot(100);
    const short = await booked(shortLot, 30);
    await weigh(short);
    await prisma.lot.update({ where: { id: shortLot }, data: { currentBalanceBags: 20 } });
    const tooMany = await finalize(short);
    expect(tooMany.statusCode).toBe(422);
    expect(code(tooMany)).toBe('LOT_BALANCE_INSUFFICIENT');
    expect(await balanceOf(shortLot)).toBe(20);
    expect(await prisma.invoice.count({ where: { outboundEventId: { in: [full, onClosed, short] } } })).toBe(0);
  });
});

describe('booking: bags on open withdrawals are held', () => {
  it('two concurrent partial bookings that together exceed the lot: one is booked, the other gets LOT_BALANCE_RESERVED', async () => {
    for (let round = 0; round < 3; round++) {
      const lotId = await createLot(100);
      const [a, b] = await Promise.all([book(lotId, 60), book(lotId, 60)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
      const loser = [a, b].find((r) => r.statusCode === 409)!;
      expect(code(loser)).toBe('LOT_BALANCE_RESERVED');
      expect(JSON.parse(loser.body).error.message).toMatch(/DN-/);
      expect(await prisma.outboundEvent.count({ where: { lotId } })).toBe(1);
    }
  });

  it('a FULL booking waits for the open partial: refused while it is open, accepted once it is cancelled', async () => {
    const lotId = await createLot(100);
    const partial = await booked(lotId, 30);

    const refused = await book(lotId, 100, 'FULL');
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('LOT_BALANCE_RESERVED');

    // The free remainder can still be booked.
    expect((await book(lotId, 70)).statusCode).toBe(201);
    expect((await book(lotId, 1)).statusCode).toBe(409);

    const cancelled = await cancel(partial);
    expect(cancelled.statusCode).toBe(200);
    expect(data<{ status: string }>(cancelled).status).toBe('CANCELLED');
  });

  it('dispatched withdrawals stop holding bags; the balance has already dropped', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 40);
    await weigh(ob);
    expect((await finalize(ob)).statusCode).toBe(200);
    expect((await book(lotId, 59)).statusCode).toBe(201);
  });
});

describe('cancelling a withdrawal', () => {
  it('cancels PENDING and WEIGHED withdrawals with the void trail, leaving the lot untouched', async () => {
    const lotId = await createLot(100);
    const pending = await booked(lotId, 10);
    const weighed = await booked(lotId, 20);
    await weigh(weighed);

    for (const id of [pending, weighed]) {
      const res = await cancel(id);
      expect(res.statusCode).toBe(200);
      const body = data<{ status: string; void_reason: string; voided_at: string }>(res);
      expect(body.status).toBe('CANCELLED');
      expect(body.void_reason).toBe('customer did not come');
      expect(body.voided_at).toBeTruthy();
    }
    expect(await balanceOf(lotId)).toBe(100);
    const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: weighed } });
    expect(row.voidedBy).toBeTruthy();
  });

  it('a cancelled withdrawal cannot be weighed, dispatched, cancelled again or printed', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 10);
    await weigh(ob);
    expect((await cancel(ob)).statusCode).toBe(200);

    const w = await weigh(ob);
    expect([w.statusCode, code(w)]).toEqual([409, 'OUTBOUND_CANCELLED']);
    const f = await finalize(ob);
    expect([f.statusCode, code(f)]).toEqual([409, 'OUTBOUND_CANCELLED']);
    const again = await cancel(ob);
    expect([again.statusCode, code(again)]).toEqual([409, 'OUTBOUND_CANCELLED']);
    const pdf = await app.inject({
      method: 'GET',
      url: `/v1/outbound-events/${ob}/dispatch-note`,
      headers: authHeaders(operatorToken),
    });
    expect([pdf.statusCode, code(pdf)]).toEqual([409, 'OUTBOUND_CANCELLED']);
  });

  it('a dispatched withdrawal cannot be cancelled', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 10);
    await weigh(ob);
    await finalize(ob);
    const res = await cancel(ob);
    expect([res.statusCode, code(res)]).toEqual([409, 'OUTBOUND_ALREADY_FINALIZED']);
    expect(await balanceOf(lotId)).toBe(90);
  });

  it('cancel racing finalize ends in exactly one consistent state', async () => {
    for (let round = 0; round < 3; round++) {
      const lotId = await createLot(100);
      const ob = await booked(lotId, 30);
      await weigh(ob);
      const [c, f] = await Promise.all([cancel(ob), finalize(ob)]);
      const row = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: ob } });
      if (row.status === 'DISPATCHED') {
        expect([f.statusCode, c.statusCode, code(c)]).toEqual([200, 409, 'OUTBOUND_ALREADY_FINALIZED']);
        expect(await balanceOf(lotId)).toBe(70);
      } else {
        expect(row.status).toBe('CANCELLED');
        expect([c.statusCode, f.statusCode, code(f)]).toEqual([200, 409, 'OUTBOUND_CANCELLED']);
        expect(await balanceOf(lotId)).toBe(100);
        expect(await prisma.invoice.count({ where: { outboundEventId: ob } })).toBe(0);
      }
    }
  });

  it('needs a reason, and the booking permission', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 10);
    const noReason = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${ob}/cancel`,
      headers: authHeaders(operatorToken),
      payload: { reason: '' },
    });
    expect(noReason.statusCode).toBe(400);
    const security = await loginAsRole(app, 'SECURITY');
    expect((await cancel(ob, security.accessToken)).statusCode).toBe(403);
  });
});

describe('booking details', () => {
  it('stores the vehicle number trimmed and upper-cased', async () => {
    const lotId = await createLot(100);
    const res = await book(lotId, 10, 'PARTIAL', { vehicle_number: '  lhr-1234 ' });
    expect(res.statusCode).toBe(201);
    expect(data<{ vehicle_number: string }>(res).vehicle_number).toBe('LHR-1234');
  });

  it("a future outbound date is refused below MANAGER — against the facility's calendar", async () => {
    const lotId = await createLot(100);
    const tomorrow = addDays(businessDate(), 1);
    const op = await book(lotId, 10, 'PARTIAL', { outbound_date: tomorrow });
    expect(op.statusCode).toBe(422);
    expect(code(op)).toBe('DATE_IN_FUTURE');

    const mgr = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(managerToken),
      payload: { lot_id: lotId, withdrawal_type: 'PARTIAL', quantity_withdrawn_bags: 10, outbound_date: tomorrow },
    });
    expect(mgr.statusCode).toBe(201);
  });

  it('a dispatch is on the audit trail, attributed to the manager who did it', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 10);
    await weigh(ob);
    expect((await finalize(ob)).statusCode).toBe(200);
    const rows = await prisma.$queryRawUnsafe<{ action: string; changed_by: string; status: string }[]>(
      `SELECT action::text AS action, changed_by::text AS changed_by, new_values->>'status' AS status
         FROM audit_log WHERE table_name = 'outbound_events' AND record_id = $1::uuid ORDER BY changed_at`,
      ob,
    );
    const dispatched = rows.find((r) => r.action === 'UPDATE' && r.status === 'DISPATCHED');
    expect(dispatched).toBeDefined();
    expect(dispatched!.changed_by).toBe(managerId);
  });
});

describe('ownership transfers respect open withdrawals', () => {
  function transfer(lotId: string, payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/transfer`,
      headers: authHeaders(managerToken),
      payload: { to_party_id: buyerPartyId, effective_date: '2026-04-15', ...payload },
    });
  }

  it('a partial transfer may take only the free bags', async () => {
    const lotId = await createLot(100);
    await booked(lotId, 60);
    const over = await transfer(lotId, { transfer_type: 'PARTIAL', quantity_bags: 50 });
    expect(over.statusCode).toBe(409);
    expect(code(over)).toBe('LOT_BALANCE_RESERVED');
    expect(JSON.parse(over.body).error.field).toBe('quantity_bags');
    expect(await balanceOf(lotId)).toBe(100);

    const within = await transfer(lotId, { transfer_type: 'PARTIAL', quantity_bags: 40 });
    expect(within.statusCode).toBe(201);
    expect(await balanceOf(lotId)).toBe(60);
  });

  it('a full transfer waits until no withdrawal is open', async () => {
    const lotId = await createLot(100);
    const ob = await booked(lotId, 10);
    const refused = await transfer(lotId, { transfer_type: 'FULL' });
    expect(refused.statusCode).toBe(409);
    expect(code(refused)).toBe('LOT_BALANCE_RESERVED');

    expect((await cancel(ob)).statusCode).toBe(200);
    expect((await transfer(lotId, { transfer_type: 'FULL' })).statusCode).toBe(201);
  });
});
