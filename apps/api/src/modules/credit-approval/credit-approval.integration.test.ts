/**
 * Standing credit approvals (fast-dispatch Phase C1a). A manager pre-approves a party for credit;
 * the gate then releases that party's credit-billed truck without a manager present, and stamps the
 * approval on the pass. The point of every case below is that the control did not loosen: an
 * expired, revoked, missing or exceeded approval leaves the truck exactly as blocked as before, and
 * the guard never learns the ceiling.
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
let securityToken: string;
let partyId: string;
let managerId: string;

type Res = { statusCode: number; body: string };
const json = (r: Res) => JSON.parse(r.body);
const code = (r: Res) => json(r).error?.code as string | undefined;
const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });

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
    await prisma.partyCreditApproval.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

/** A credit-billed truck of `quantity` bags: dispatched and billed by a manager, nothing collected. */
async function creditTruck(quantity: number, plate: string) {
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
  const preview = await call('GET', `/v1/outbound-events/${id}/checkout-preview`, managerToken);
  const total = json(preview).data.total_pkr as number;
  const done = await call('POST', `/v1/outbound-events/${id}/dispatch-and-collect`, managerToken, {
    expected_total_pkr: total,
    payment: { mode: 'CREDIT' },
  });
  expect(done.statusCode, done.body).toBe(200);
  const inward = await call('POST', '/v1/gate-passes/inward', securityToken, { vehicle_number: plate });
  expect(inward.statusCode, inward.body).toBe(201);
  return { id, total, passId: json(inward).data.id as string };
}

const release = (passId: string, quantity: number, token = securityToken, extra: Record<string, unknown> = {}) =>
  call('POST', `/v1/gate-passes/${passId}/outward`, token, { declared_quantity: quantity, ...extra });

async function previewOf(plate: string) {
  const res = await call('GET', '/v1/gate-passes?active=true&page_size=50', securityToken);
  const row = (json(res).data as { vehicle_number: string; release: Record<string, unknown> }[]).find(
    (p) => p.vehicle_number === plate,
  );
  return row!.release as { state: string; on_credit?: boolean; outstanding_pkr: number };
}

const grant = (max: number, extra: Record<string, unknown> = {}, token = managerToken) =>
  call('POST', `/v1/parties/${partyId}/credit-approval`, token, { max_outstanding_pkr: max, ...extra });

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  const manager = await loginAsRole(app, 'MANAGER');
  managerToken = manager.accessToken;
  managerId = manager.user.id;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;

  const party = await call('POST', '/v1/parties', operatorToken, {
    name: `Credit-Farmer-${Date.now()}`,
    party_type: 'FARMER',
    phone_primary: '03019390088',
  });
  expect(party.statusCode, party.body).toBe(201);
  partyId = json(party).data.id;
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

describe('granting, reading and revoking', () => {
  it('is a manager’s act (parties.credit_terms): the munshi and the guard are refused', async () => {
    expect((await grant(500_000, {}, operatorToken)).statusCode).toBe(403);
    expect((await grant(500_000, {}, securityToken)).statusCode).toBe(403);
    const ok = await grant(500_000);
    expect(ok.statusCode, ok.body).toBe(201);
    expect(json(ok).data).toMatchObject({ approved: true, max_outstanding_pkr: 500_000, approved_by_name: expect.any(String) });
  });

  it('shows everyone whether credit is approved, but the ceiling only to those who set it', async () => {
    await grant(750_000, { note: 'Haji Sahib, season account' });
    const asManager = json(await call('GET', `/v1/parties/${partyId}/credit-approval`, managerToken)).data;
    expect(asManager).toMatchObject({ approved: true, max_outstanding_pkr: 750_000, note: 'Haji Sahib, season account' });
    for (const token of [operatorToken, securityToken]) {
      const seen = json(await call('GET', `/v1/parties/${partyId}/credit-approval`, token)).data;
      expect(seen.approved).toBe(true);
      expect(seen.max_outstanding_pkr).toBeNull();
      expect(seen.note).toBeNull();
    }
  });

  it('a new approval replaces the old one: one live row, the history kept', async () => {
    await grant(100_000);
    await grant(900_000);
    const rows = await prisma.partyCreditApproval.findMany({ where: { partyId }, orderBy: { approvedAt: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.revokedAt).not.toBeNull();
    expect(rows[0]!.revokeReason).toMatch(/Replaced/);
    expect(rows[1]!.revokedAt).toBeNull();
    expect(Number(rows[1]!.maxOutstandingPkr)).toBe(900_000);
  });

  it('two grants at once leave exactly one live approval (the other is revoked, never doubled)', async () => {
    const [a, b] = await Promise.all([grant(100_000), grant(200_000)]);
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(await prisma.partyCreditApproval.count({ where: { partyId, revokedAt: null } })).toBe(1);
  });

  it('refuses a date that has already passed, and a revoke with nothing to revoke', async () => {
    const past = await grant(100_000, { valid_until: addDays(businessDate(), -1) });
    expect([past.statusCode, code(past)]).toEqual([400, 'VALIDATION_ERROR']);
    const none = await call('POST', `/v1/parties/${partyId}/credit-approval/revoke`, managerToken, { reason: 'no longer trusted' });
    expect(none.statusCode).toBe(400);
  });

  it('revoking needs a reason and ends the approval', async () => {
    await grant(100_000);
    const noReason = await call('POST', `/v1/parties/${partyId}/credit-approval/revoke`, managerToken, { reason: '' });
    expect(noReason.statusCode).toBe(400);
    const res = await call('POST', `/v1/parties/${partyId}/credit-approval/revoke`, managerToken, { reason: 'Cheque bounced' });
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res).data.approved).toBe(false);
    const row = await prisma.partyCreditApproval.findFirstOrThrow({ where: { partyId } });
    expect([row.revokedBy, row.revokeReason]).toEqual([managerId, 'Cheque bounced']);
  });
});

describe('at the gate', () => {
  it('without an approval a credit-billed truck is held, as before', async () => {
    const t = await creditTruck(40, 'LHR-7001');
    expect((await previewOf('LHR-7001')).state).toBe('PAYMENT_PENDING');
    const res = await release(t.passId, 40);
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
  });

  it('with an approval the guard sees READY “on credit” and releases it alone; the pass names the approval', async () => {
    const approval = json(await grant(5_000_000)).data;
    const t = await creditTruck(40, 'LHR-7002');
    const preview = await previewOf('LHR-7002');
    expect(preview.state).toBe('READY');
    expect(preview.on_credit).toBe(true);
    // The guard is told the truck is on credit, never the ceiling.
    expect(JSON.stringify(preview)).not.toContain('5000000');

    const res = await release(t.passId, 40);
    expect(res.statusCode, res.body).toBe(200);
    expect(json(res).data.status).toBe('CLEARED');
    const pass = await prisma.gatePass.findUniqueOrThrow({ where: { id: t.passId } });
    expect(pass.creditAuthorizedBy).toBe(managerId); // the manager who approved the party
    expect(pass.creditApprovalIds).toEqual([approval.id]);
    expect(Number(pass.creditAuthorizedAmountPkr)).toBeCloseTo(t.total, 2);
    expect(pass.clearedBy).not.toBe(managerId); // the guard released it
  });

  it('a manager who ticks “authorize on credit” is still the authority, with no approval named', async () => {
    await grant(5_000_000);
    const t = await creditTruck(30, 'LHR-7003');
    const res = await release(t.passId, 30, managerToken, { credit_authorization: true });
    expect(res.statusCode, res.body).toBe(200);
    const pass = await prisma.gatePass.findUniqueOrThrow({ where: { id: t.passId } });
    expect(pass.creditAuthorizedBy).toBe(managerId);
    expect(pass.creditApprovalIds).toEqual([]);
  });

  it('a ceiling the party’s exposure would exceed holds the truck — preview and release agree', async () => {
    await grant(10); // far below the bill
    const t = await creditTruck(40, 'LHR-7004');
    expect((await previewOf('LHR-7004')).state).toBe('PAYMENT_PENDING');
    const res = await release(t.passId, 40);
    expect([res.statusCode, code(res)]).toEqual([422, 'GATE_OUTWARD_BLOCKED']);
    expect((await prisma.gatePass.findUniqueOrThrow({ where: { id: t.passId } })).status).not.toBe('CLEARED');
  });

  it('a lapsed approval holds the truck', async () => {
    await grant(5_000_000);
    await prisma.partyCreditApproval.updateMany({ where: { partyId, revokedAt: null }, data: { validUntil: new Date(addDays(businessDate(), -1)) } });
    const t = await creditTruck(40, 'LHR-7005');
    expect((await previewOf('LHR-7005')).state).toBe('PAYMENT_PENDING');
    expect(code(await release(t.passId, 40))).toBe('GATE_OUTWARD_BLOCKED');
  });

  it('an approval valid through today still holds today', async () => {
    await grant(5_000_000, { valid_until: businessDate() });
    const t = await creditTruck(40, 'LHR-7006');
    expect((await previewOf('LHR-7006')).state).toBe('READY');
    expect((await release(t.passId, 40)).statusCode).toBe(200);
  });

  it('a revoked approval holds the truck', async () => {
    await grant(5_000_000);
    const t = await creditTruck(40, 'LHR-7007');
    expect((await previewOf('LHR-7007')).state).toBe('READY');
    await call('POST', `/v1/parties/${partyId}/credit-approval/revoke`, managerToken, { reason: 'Changed our mind' });
    expect((await previewOf('LHR-7007')).state).toBe('PAYMENT_PENDING');
    expect(code(await release(t.passId, 40))).toBe('GATE_OUTWARD_BLOCKED');
  });

  it('the guard’s blind count still applies on a credit release', async () => {
    await grant(5_000_000);
    const t = await creditTruck(40, 'LHR-7008');
    const wrong = await release(t.passId, 7);
    expect([wrong.statusCode, code(wrong)]).toEqual([422, 'GATE_OUTWARD_COUNT_MISMATCH']);
    expect((await release(t.passId, 40)).statusCode).toBe(200);
  });

  it('an unbilled (voided) withdrawal never leaves on a standing approval', async () => {
    await grant(5_000_000);
    const t = await creditTruck(40, 'LHR-7009');
    await withGuardsDisabled(prisma, async () => {
      await prisma.invoice.updateMany({ where: { outboundEventId: t.id }, data: { status: 'VOID' } });
    });
    expect((await previewOf('LHR-7009')).state).toBe('PAYMENT_PENDING');
    expect(code(await release(t.passId, 40))).toBe('GATE_OUTWARD_BLOCKED');
  });
});
