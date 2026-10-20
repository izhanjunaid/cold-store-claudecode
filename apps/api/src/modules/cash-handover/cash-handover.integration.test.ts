/**
 * Cash handovers (fast-dispatch Phase C1c). The desk takes cash; a manager counts it. The cases that
 * matter are the ones where cash could be lost or counted twice: a count of the wrong pool, two
 * managers counting the same cash at once, a collector counting their own, a difference that never
 * reached the ledger, and a voided count that does not free its receipts.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
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
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let operatorToken: string;
let accountantToken: string;
let securityToken: string;
let partyId: string;
let managerId: string;
let ownerId: string;
let operatorId: string;
let originalSettings: Record<string, unknown>;

type Res = { statusCode: number; body: string };
const json = (r: Res) => JSON.parse(r.body);
const code = (r: Res) => json(r).error?.code as string | undefined;
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });

async function setTracking(from: string | null) {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } });
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: { ...(facility.settings as Record<string, unknown>), cash_tracking_from: from } },
  });
}

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.cashHandoverPayment.deleteMany({ where: { handover: { facilityId: TEST_FACILITY_ID } } });
    await prisma.cashHandover.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
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

/** A weighed withdrawal of `quantity` bags, dispatched and paid by `token` in `mode`. Returns the bill. */
async function dispatchedBy(token: string, quantity: number, plate: string, mode: 'CASH' | 'CREDIT' | 'CHEQUE' = 'CASH') {
  const lot = await call('POST', '/v1/lots', operatorToken, {
    owner_party_id: partyId,
    commodity_id: POTATO_ID,
    rate_plan_id: RATE_PLAN_SEASONAL,
    chamber_id: CHAMBER_A,
    quantity_bags: quantity,
    accepted_weight_kg: quantity * 20,
    inbound_date: '2026-04-10',
  });
  expect(lot.statusCode, lot.body).toBe(201);
  const ob = await call('POST', '/v1/outbound-events', operatorToken, {
    lot_id: json(lot).data.id,
    withdrawal_type: 'FULL',
    quantity_withdrawn_bags: quantity,
    outbound_date: businessDate(),
    vehicle_number: plate,
  });
  expect(ob.statusCode, ob.body).toBe(201);
  const id = json(ob).data.id as string;
  const w = await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${id}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: quantity * 19.5 },
  });
  expect(w.statusCode, w.body).toBe(200);
  const total = json(await call('GET', `/v1/outbound-events/${id}/checkout-preview`, token)).data.total_pkr as number;
  const done = await call('POST', `/v1/outbound-events/${id}/dispatch-and-collect`, token, {
    expected_total_pkr: total,
    payment: mode === 'CHEQUE' ? { mode, cheque_date: businessDate(), reference_number: 'CHQ-1' } : { mode },
  });
  expect(done.statusCode, done.body).toBe(200);
  return total;
}

const dayOf = async (token: string) => json(await call('GET', '/v1/dispatch/day', token)).data;
const pendingOf = async (collectorId: string, token = ownerToken) =>
  (json(await call('GET', '/v1/dispatch/day', token)).data.rows as { user_id: string; pending_cash_pkr: number }[]).find(
    (r) => r.user_id === collectorId,
  )?.pending_cash_pkr ?? 0;
const hand = (collectorId: string, expected: number, counted: number, extra: Record<string, unknown> = {}, token = ownerToken) =>
  call('POST', '/v1/cash-handovers', token, { collector_id: collectorId, expected_cash_pkr: expected, counted_cash_pkr: counted, ...extra });
const linesOf = (entryId: string) => prisma.journalEntryLine.findMany({ where: { journalEntryId: entryId } });

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  originalSettings = (await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings as Record<string, unknown>;
  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  ownerId = owner.user.id;
  const manager = await loginAsRole(app, 'MANAGER');
  managerToken = manager.accessToken;
  managerId = manager.user.id;
  const operator = await loginAsRole(app, 'OPERATOR');
  operatorToken = operator.accessToken;
  operatorId = operator.user.id;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;

  const party = await call('POST', '/v1/parties', operatorToken, {
    name: `Handover-Farmer-${Date.now()}`,
    party_type: 'FARMER',
    phone_primary: '03019390099',
  });
  expect(party.statusCode, party.body).toBe(201);
  partyId = json(party).data.id;
}, 30_000);

afterEach(async () => {
  await cleanup();
  await setTracking(null);
});

afterAll(async () => {
  await cleanup();
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: originalSettings as object } });
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

describe('tracking', () => {
  it('is off until the owner switches it on: nothing is pending and a handover is refused', async () => {
    await dispatchedBy(managerToken, 20, 'LHR-8001');
    const day = await dayOf(managerToken);
    expect(day.tracking).toBe(false);
    expect(day.rows.find((r: { user_id: string }) => r.user_id === managerId).pending_cash_pkr).toBeNull();
    const res = await hand(managerId, 1, 1);
    expect([res.statusCode, code(res)]).toEqual([409, 'CASH_TRACKING_OFF']);
  });

  it('counts only cash taken on or after the tracking day', async () => {
    await setTracking(addDays(businessDate(), 1)); // starts tomorrow: today's cash is out of scope
    await dispatchedBy(managerToken, 20, 'LHR-8002');
    expect(await pendingOf(managerId)).toBe(0);
    const res = await hand(managerId, 0, 0);
    expect([res.statusCode, code(res)]).toEqual([409, 'HANDOVER_NOTHING_PENDING']);
  });
});

describe("the day's totals", () => {
  it('give each collector their own cash, cheques, credit and dispatches; the munshi sees only their row', async () => {
    await setTracking(businessDate());
    const cash = await dispatchedBy(managerToken, 20, 'LHR-8003');
    const credit = await dispatchedBy(managerToken, 10, 'LHR-8004', 'CREDIT');
    const cheque = await dispatchedBy(managerToken, 10, 'LHR-8005', 'CHEQUE');

    const asOwner = await dayOf(ownerToken);
    expect(asOwner.can_count).toBe(true);
    const mine = asOwner.rows.find((r: { user_id: string }) => r.user_id === managerId);
    expect(mine).toMatchObject({ dispatched: 3, cheques_count: 1, pending_receipts: 1 });
    expect(mine.cash_collected_pkr).toBeCloseTo(cash, 2);
    expect(mine.cheques_pkr).toBeCloseTo(cheque, 2);
    expect(mine.credit_billed_pkr).toBeCloseTo(credit, 2);
    expect(mine.pending_cash_pkr).toBeCloseTo(cash, 2); // a cheque is not cash, credit is not cash

    const asOperator = await dayOf(operatorToken);
    expect(asOperator.can_count).toBe(false);
    expect(asOperator.rows.map((r: { user_id: string }) => r.user_id)).toEqual([operatorId]);
    expect(asOperator.rows[0]).toMatchObject({ dispatched: 0, cash_collected_pkr: 0 });
  });

  it('is for those who book withdrawals: the guard is refused', async () => {
    expect((await call('GET', '/v1/dispatch/day', securityToken)).statusCode).toBe(403);
  });
});

describe('counting the cash', () => {
  it('a count equal to the receipts is a clean handover: numbered, no journal entry, pool emptied', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8010');
    const res = await hand(managerId, total, total);
    expect(res.statusCode, res.body).toBe(201);
    const h = json(res).data;
    expect(h.handover_number).toMatch(/^CHO-\d{6}-0001$/);
    expect(h).toMatchObject({ collector_id: managerId, confirmed_by: ownerId, variance_pkr: 0, receipts: 1, journal_entry_id: null });
    expect(await pendingOf(managerId)).toBe(0);
    const again = await hand(managerId, total, total);
    expect([again.statusCode, code(again)]).toEqual([409, 'HANDOVER_NOTHING_PENDING']);
  });

  it('a shortage needs its reason and posts DR Cash Short & Over / CR Cash on Hand', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8011');
    const noReason = await hand(managerId, total, total - 500);
    expect([noReason.statusCode, code(noReason)]).toEqual([400, 'VALIDATION_ERROR']);
    expect(await prisma.cashHandover.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);

    const res = await hand(managerId, total, total - 500, { variance_reason: 'Rs 500 note was torn, discarded' });
    expect(res.statusCode, res.body).toBe(201);
    const h = json(res).data;
    expect(h.variance_pkr).toBe(-500);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { facilityId: TEST_FACILITY_ID, sourceTable: 'cash_handovers', sourceId: h.id } });
    expect(entry.entryType).toBe('CASH_VARIANCE');
    const lines = await linesOf(entry.id);
    expect(lines.map((l) => [l.accountCode, Number(l.debitAmount), Number(l.creditAmount)]).sort()).toEqual([
      ['1010', 0, 500],
      ['6105', 500, 0],
    ]);
  });

  it('an overage posts the other way round', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8012');
    const res = await hand(managerId, total, total + 250, { variance_reason: 'A customer paid a tip' });
    expect(res.statusCode, res.body).toBe(201);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { facilityId: TEST_FACILITY_ID, sourceTable: 'cash_handovers', sourceId: json(res).data.id } });
    expect((await linesOf(entry.id)).map((l) => [l.accountCode, Number(l.debitAmount), Number(l.creditAmount)]).sort()).toEqual([
      ['1010', 250, 0],
      ['6105', 0, 250],
    ]);
  });

  it('refuses when the cash waiting changed since the manager looked, and says what it is now', async () => {
    await setTracking(businessDate());
    const first = await dispatchedBy(managerToken, 20, 'LHR-8013');
    const shown = await pendingOf(managerId);
    expect(shown).toBeCloseTo(first, 2);
    const second = await dispatchedBy(managerToken, 10, 'LHR-8014'); // a truck is paid while the manager counts
    const res = await hand(managerId, shown, shown);
    expect([res.statusCode, code(res)]).toEqual([409, 'HANDOVER_EXPECTED_CHANGED']);
    expect(json(res).error.message).toContain((first + second).toFixed(2));
    expect(await prisma.cashHandover.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
    // Shown the new figure, it goes through.
    expect((await hand(managerId, first + second, first + second)).statusCode).toBe(201);
  });

  it('nobody counts their own cash, and the owner’s own cash is not tracked', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8015');
    const own = await hand(managerId, total, total, {}, managerToken);
    expect([own.statusCode, code(own)]).toEqual([403, 'HANDOVER_SELF_CONFIRM']);
    // The owner takes a cash truck: there is nobody above to count it.
    await dispatchedBy(ownerToken, 10, 'LHR-8016');
    expect(await pendingOf(ownerId)).toBe(0);
    const res = await hand(ownerId, 0, 0, {}, managerToken);
    expect([res.statusCode, code(res)]).toEqual([409, 'HANDOVER_NOTHING_PENDING']);
  });

  it('is a manager’s act: the munshi, the accountant and the guard cannot count cash', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8017');
    for (const token of [operatorToken, accountantToken, securityToken]) {
      expect((await hand(managerId, total, total, {}, token)).statusCode).toBe(403);
      expect((await call('GET', '/v1/cash-handovers', token)).statusCode).toBe(403);
    }
  });

  it('two counts of the same cash at once: one wins, the other finds nothing waiting — counted once', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8018');
    const [a, b] = await Promise.all([hand(managerId, total, total), hand(managerId, total, total)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const loser = [a, b].find((r) => r.statusCode === 409)!;
    expect(code(loser)).toBe('HANDOVER_NOTHING_PENDING');
    expect(await prisma.cashHandover.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(1);
    expect(await prisma.cashHandoverPayment.count({ where: { handover: { facilityId: TEST_FACILITY_ID } } })).toBe(1);
  });

  it('the database itself refuses a receipt in two handovers, and a count of one’s own cash', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8019');
    const res = await hand(managerId, total, total);
    const payment = await prisma.cashHandoverPayment.findFirstOrThrow({ where: { handover: { facilityId: TEST_FACILITY_ID } } });
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO cash_handovers (facility_id, handover_number, business_date, collector_id, confirmed_by, expected_cash_pkr, counted_cash_pkr, variance_pkr)
         VALUES ('${TEST_FACILITY_ID}', 'CHO-999999-9999', CURRENT_DATE, '${managerId}', '${managerId}', 0, 0, 0)`,
      ),
    ).rejects.toThrow(); // confirmed_by = collector_id
    const other = await prisma.cashHandover.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        handoverNumber: 'CHO-999999-9998',
        businessDate: new Date(businessDate()),
        collectorId: managerId,
        confirmedBy: ownerId,
        expectedCashPkr: 0,
        countedCashPkr: 0,
        variancePkr: 0,
      },
    });
    await expect(prisma.cashHandoverPayment.create({ data: { handoverId: other.id, paymentId: payment.paymentId } })).rejects.toThrow();
    expect(res.statusCode).toBe(201);
  });
});

describe('voiding a handover', () => {
  it('reverses the difference entry, frees the receipts for a recount, and cannot be voided twice', async () => {
    await setTracking(businessDate());
    const total = await dispatchedBy(managerToken, 20, 'LHR-8020');
    const h = json(await hand(managerId, total, total - 100, { variance_reason: 'Short by one note' })).data;
    expect(await pendingOf(managerId)).toBe(0);

    const noReason = await call('POST', `/v1/cash-handovers/${h.id}/void`, ownerToken, { reason: '' });
    expect(noReason.statusCode).toBe(400);
    const voided = await call('POST', `/v1/cash-handovers/${h.id}/void`, ownerToken, { reason: 'Counted the wrong drawer' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(json(voided).data.voided_at).not.toBeNull();

    // Original and its mirror carry the handover as their source and net to zero per account.
    const entries = await prisma.journalEntry.findMany({ where: { facilityId: TEST_FACILITY_ID, sourceTable: 'cash_handovers', sourceId: h.id } });
    expect(entries).toHaveLength(2);
    const net = new Map<string, number>();
    for (const e of entries) for (const l of await linesOf(e.id)) net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + Number(l.debitAmount) - Number(l.creditAmount));
    expect([...net.values()].every((v) => Math.abs(v) < 0.005)).toBe(true);

    expect(await pendingOf(managerId)).toBeCloseTo(total, 2); // back in the pool
    const again = await call('POST', `/v1/cash-handovers/${h.id}/void`, ownerToken, { reason: 'Again' });
    expect([again.statusCode, code(again)]).toEqual([409, 'HANDOVER_ALREADY_VOIDED']);
    expect((await hand(managerId, total, total)).statusCode).toBe(201); // recount succeeds
  });

  it('lists handovers, filterable to those with a difference', async () => {
    await setTracking(businessDate());
    const a = await dispatchedBy(managerToken, 20, 'LHR-8021');
    await hand(managerId, a, a);
    const b = await dispatchedBy(managerToken, 10, 'LHR-8022');
    await hand(managerId, b, b - 50, { variance_reason: 'Torn note' });
    const all = json(await call('GET', '/v1/cash-handovers', ownerToken)).data as { variance_pkr: number }[];
    expect(all).toHaveLength(2);
    const diff = json(await call('GET', '/v1/cash-handovers?has_variance=true', ownerToken)).data as { variance_pkr: number }[];
    expect(diff.map((h) => h.variance_pkr)).toEqual([-50]);
  });
});
