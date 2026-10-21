/**
 * The gate guard counts bags BLIND, so everything the API sends the SECURITY role has its stock
 * quantities nulled (common/blind-count.ts), and the documents that carry a count inside text or
 * a PDF are refused. Every case asserts both sides: the guard sees nothing, and everyone else
 * still sees the real numbers (a redaction that blanked the data for all would pass a one-sided test).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { BLIND_KEYS } from '../../common/blind-count';
import { renderGatePassReceipt } from '../pdf/pdf.service';

vi.mock('../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
  renderPlacementSlip: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slip\n')),
  renderPlacementSlipHtml: vi.fn().mockReturnValue('<html>slip</html>'),
  renderGatePassReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 gp\n')),
}));

const prisma = new PrismaClient();

const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RACK_A1 = '00000000-0000-0000-0000-000000000210';
const RACK_A2 = '00000000-0000-0000-0000-000000000211';
const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';
const PLATE = 'LHR-9101';

let app: FastifyInstance;
let securityToken: string;
let operatorToken: string;
let managerToken: string;
let partyId: string;
let lotId: string;
let lotNumber: string;
let outboundId: string;
let passId: string;
let wrongCount: Res;
let release: Res;

type Res = { statusCode: number; body: string };
const json = (r: Res) => JSON.parse(r.body);
const get = (url: string, token: string) => app.inject({ method: 'GET', url, headers: authHeaders(token) });

/** Every stock-quantity field in a payload: [path, value]. */
function counts(node: unknown, path = ''): [string, unknown][] {
  if (Array.isArray(node)) return node.flatMap((v, i) => counts(v, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      BLIND_KEYS.has(k) ? [[`${path}.${k}`, v] as [string, unknown]] : counts(v, `${path}.${k}`),
    );
  }
  return [];
}
const shown = (r: Res) => counts(json(r).data).filter(([, v]) => v !== null);

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

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;

  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: `Blind-Farmer-${Date.now()}`, party_type: 'FARMER', phone_primary: '03019390077' },
  });
  expect(party.statusCode, party.body).toBe(201);
  partyId = json(party).data.id;

  // A 200-bag lot in two racks; 50 bags go out on a truck that is dispatched, paid and then released.
  const lot = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: 200,
      accepted_weight_kg: 4000,
      inbound_date: '2026-04-10',
      placements: [
        { rack_id: RACK_A1, bags: 120 },
        { rack_id: RACK_A2, bags: 80 },
      ],
    },
  });
  expect(lot.statusCode, lot.body).toBe(201);
  lotId = json(lot).data.id;
  lotNumber = json(lot).data.lot_number;

  const ob = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: { lot_id: lotId, withdrawal_type: 'PARTIAL', quantity_withdrawn_bags: 50, outbound_date: '2026-09-01', vehicle_number: PLATE },
  });
  expect(ob.statusCode, ob.body).toBe(201);
  outboundId = json(ob).data.id;
  const w = await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 975 },
  });
  expect(w.statusCode, w.body).toBe(200);
  const pv = await get(`/v1/outbound-events/${outboundId}/checkout-preview`, managerToken);
  const co = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/dispatch-and-collect`,
    headers: authHeaders(managerToken),
    payload: { expected_total_pkr: json(pv).data.total_pkr, payment: { mode: 'CASH' } },
  });
  expect(co.statusCode, co.body).toBe(200);

  // The guard logs the truck in, counts its 50 bags blind, and releases it: the pass now carries an authorized quantity.
  const inward = await app.inject({
    method: 'POST',
    url: '/v1/gate-passes/inward',
    headers: authHeaders(securityToken),
    payload: { vehicle_number: PLATE },
  });
  expect(inward.statusCode, inward.body).toBe(201);
  passId = json(inward).data.id;

  wrongCount = await app.inject({
    method: 'POST',
    url: `/v1/gate-passes/${passId}/outward`,
    headers: authHeaders(securityToken),
    payload: { declared_quantity: 7 },
  });
  release = await app.inject({
    method: 'POST',
    url: `/v1/gate-passes/${passId}/outward`,
    headers: authHeaders(securityToken),
    payload: { declared_quantity: 50 },
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

describe('the guard reads no stock quantity', () => {
  // [url, an assertion that the real numbers are there for everyone else]
  const reads: [string, () => string][] = [
    ['lot list', () => `/v1/lots?search=${lotNumber}`],
    ['lot', () => `/v1/lots/${lotId}`],
    ['lot placements', () => `/v1/lots/${lotId}/placements`],
    ['lot movements', () => `/v1/lots/${lotId}/movements`],
    ['lot ownership history', () => `/v1/lots/${lotId}/ownership-history`],
    ['lot withdrawals', () => `/v1/lots/${lotId}/outbound-events`],
    ['withdrawal', () => `/v1/outbound-events/${outboundId}`],
    ['rooms', () => '/v1/chambers'],
    ['a room', () => `/v1/chambers/${CHAMBER_A}`],
    ['a rack\'s lots', () => `/v1/racks/${RACK_A1}/lots`],
    ['the gate pass', () => `/v1/gate-passes/${passId}`],
  ];

  for (const [name, url] of reads) {
    it(`${name}: nulls for SECURITY, the real numbers for an operator`, async () => {
      const guard = await get(url(), securityToken);
      expect(guard.statusCode, guard.body).toBe(200);
      expect(shown(guard), `${name} leaked to the guard`).toEqual([]);
      // The same fields exist (as null), so the pages can render them as "not shown".
      expect(counts(json(guard).data).length).toBeGreaterThan(0);

      const operator = await get(url(), operatorToken);
      expect(operator.statusCode, operator.body).toBe(200);
      expect(shown(operator).length, `${name} shows an operator nothing`).toBeGreaterThan(0);
    });
  }

  it('a lot search by marka then its withdrawals — the old two-step route to an expected count — gives the guard nothing', async () => {
    const found = json(await get(`/v1/lots?search=${lotNumber}`, securityToken)).data as { id: string }[];
    expect(found.length).toBeGreaterThan(0);
    const events = await get(`/v1/lots/${found[0]!.id}/outbound-events`, securityToken);
    const rows = json(events).data as { vehicle_number: string; quantity_withdrawn_bags: number | null }[];
    expect(rows.find((r) => r.vehicle_number === PLATE)?.quantity_withdrawn_bags).toBeNull();
    // The operator sees the 50 it was booked for.
    const op = json(await get(`/v1/lots/${lotId}/outbound-events`, operatorToken)).data as { quantity_withdrawn_bags: number }[];
    expect(op.find((r) => r.quantity_withdrawn_bags === 50)).toBeTruthy();
  });

  it('the pass location names the racks but not how many bags sit in each', async () => {
    const guard = json(await get(`/v1/gate-passes/${passId}`, securityToken)).data;
    const manager = json(await get(`/v1/gate-passes/${passId}`, managerToken)).data;
    // Whatever the guard sees as a location, there is no "×N" in it; a manager's has the racks' counts.
    if (guard.related_location) expect(guard.related_location).not.toMatch(/×/);
    if (manager.related_location) expect(manager.related_location).toMatch(/×\d+/);
  });
});

// Weights stand in for a count (about 20 kg a bag), so they are hidden from the guard too. The
// fields are named here, not read from BLIND_KEYS: a check built on the list it is checking
// would pass whatever the list said.
describe('the guard reads no weight', () => {
  it('a lot: no inbound weights for SECURITY, the real ones for an operator', async () => {
    const guard = json(await get(`/v1/lots/${lotId}`, securityToken)).data;
    const operator = json(await get(`/v1/lots/${lotId}`, operatorToken)).data;
    expect(guard).toHaveProperty('accepted_weight_kg', null);
    expect(guard).toHaveProperty('declared_weight_kg', null);
    expect(operator.accepted_weight_kg).toBeGreaterThan(0);
  });

  it('a withdrawal: no weights and no variance for SECURITY, the real ones for an operator', async () => {
    const guard = json(await get(`/v1/outbound-events/${outboundId}`, securityToken)).data;
    const operator = json(await get(`/v1/outbound-events/${outboundId}`, operatorToken)).data;
    for (const key of ['outbound_weight_kg', 'prorated_inbound_weight_kg', 'weight_variance_pct']) {
      expect(guard, key).toHaveProperty(key, null);
    }
    expect(operator.outbound_weight_kg).toBeGreaterThan(0);
    expect(operator.prorated_inbound_weight_kg).toBeGreaterThan(0);
    expect(operator.weight_variance_pct).not.toBeNull();
  });

  it("a lot's withdrawals list: no weights for SECURITY either", async () => {
    const rows = json(await get(`/v1/lots/${lotId}/outbound-events`, securityToken)).data as Record<string, unknown>[];
    const mine = rows.find((r) => r['vehicle_number'] === PLATE)!;
    expect(mine['outbound_weight_kg']).toBeNull();
  });
});

describe("the guard's own work is unchanged", () => {
  it('a wrong count is still refused, without saying what it should have been', () => {
    expect(wrongCount.statusCode, wrongCount.body).toBe(422);
    expect(json(wrongCount).error.code).toBe('GATE_OUTWARD_COUNT_MISMATCH');
    expect(wrongCount.body).not.toMatch(/\b50\b/);
    // The message states the fact; what to do next is the gate page's to say, per role
    // (a manager gets the override box, a guard is told to recount or call one).
    expect(json(wrongCount).error.message).toBe('The bag count does not match the dispatch');
  });

  it('the right count releases the truck; the pass keeps the count they typed, and the quantity it was checked against stays hidden', async () => {
    expect(release.statusCode, release.body).toBe(200);
    const body = json(release).data;
    expect(body.declared_quantity).toBe(50); // their own count is theirs to see
    expect(body.authorized_quantity).toBeNull();
    expect(body.quantity_mismatch_flag).toBe(false);

    // A manager reads what the dispatch authorized: the same field, un-redacted.
    const manager = json(await get(`/v1/gate-passes/${passId}`, managerToken)).data;
    expect(manager.authorized_quantity).toBe(50);
    expect(manager.declared_quantity).toBe(50);
  });
});
describe('documents that carry a count in text or a PDF are not for the guard', () => {
  let invoiceId: string;
  beforeAll(async () => {
    invoiceId = (await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: outboundId } })).id;
  });

  const docs: [string, () => string][] = [
    ['an invoice', () => `/v1/invoices/${invoiceId}`],
    ['an invoice PDF', () => `/v1/invoices/${invoiceId}/pdf`],
    ["a lot's invoices", () => `/v1/lots/${lotId}/invoices`],
    ['the placement slip', () => `/v1/lots/${lotId}/placement-slip`],
  ];
  for (const [name, url] of docs) {
    it(`${name}: refused for SECURITY, served to an operator`, async () => {
      const guard = await get(url(), securityToken);
      expect(guard.statusCode, guard.body).toBe(403);
      expect(json(guard).error.code).toBe('BLIND_ROLE_FORBIDDEN');
      const operator = await get(url(), operatorToken);
      expect(operator.statusCode, operator.body).toBe(200);
    });
  }

  it('the gate receipt the guard prints is made without the authorized quantity; a manager gets it', async () => {
    const render = vi.mocked(renderGatePassReceipt);
    const guard = await get(`/v1/gate-passes/${passId}/receipt?format=pdf`, securityToken);
    expect(guard.statusCode, guard.body).toBe(200);
    expect(render.mock.calls.at(-1)![0].authorizedQuantity).toBeNull();
    const manager = await get(`/v1/gate-passes/${passId}/receipt?format=pdf`, managerToken);
    expect(manager.statusCode, manager.body).toBe(200);
    expect(render.mock.calls.at(-1)![0].authorizedQuantity).toBe(50);
  });
});
