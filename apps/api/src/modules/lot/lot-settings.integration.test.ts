import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

// Mock PDF rendering so tests don't require Chromium
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
const CHAMBER_A = '00000000-0000-0000-0000-000000000200'; // unrestricted, 1000 bags
const CHAMBER_C = '00000000-0000-0000-0000-000000000202'; // tiny, 10 bags
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let ownerPartyId: string;
let originalSettings: unknown;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function setSettings(patch: Record<string, unknown>) {
  const f = await prisma.facility.findUnique({
    where: { id: TEST_FACILITY_ID },
    select: { settings: true },
  });
  const cur =
    f?.settings && typeof f.settings === 'object' && !Array.isArray(f.settings)
      ? (f.settings as Record<string, unknown>)
      : {};
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: { ...cur, ...patch } as never },
  });
}

function lotPayload(overrides: Record<string, unknown> = {}) {
  return {
    owner_party_id: ownerPartyId,
    commodity_id: POTATO_ID,
    rate_plan_id: RATE_PLAN,
    chamber_id: CHAMBER_A,
    quantity_bags: 10,
    accepted_weight_kg: 200,
    ...overrides,
  };
}

beforeAll(async () => {
  app = await getTestApp();

  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });

  const facility = await prisma.facility.findUnique({
    where: { id: TEST_FACILITY_ID },
    select: { settings: true },
  });
  originalSettings = facility?.settings ?? {};

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;

  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: 'Settings Test Farmer',
      party_type: 'FARMER',
      phone_primary: '03009120001',
      credit_terms_days: 30,
    },
  });
  ownerPartyId = JSON.parse(partyRes.body).data.id;
});

afterAll(async () => {
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: (originalSettings ?? {}) as never },
  });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Chamber capacity warning honors chamber_capacity_warning_pct', () => {
  it('warns at the configured percentage (50%), not the old hardcoded 90%', async () => {
    await setSettings({ chamber_capacity_warning_pct: 50 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ chamber_id: CHAMBER_C, quantity_bags: 6, accepted_weight_kg: 120 }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.warnings).toBeDefined();
    expect(String(body.data.warnings)).toContain('50%');
  });

  it('no warning when below the configured percentage', async () => {
    await setSettings({ chamber_capacity_warning_pct: 50 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ quantity_bags: 10 }), // 1000-bag chamber, way below 50%
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.warnings).toBeUndefined();
  });
});

describe('Weight dispute threshold is absolute kilograms (weight_dispute_threshold_kg)', () => {
  it('small absolute variance under threshold kg → no dispute even at high % variance', async () => {
    await setSettings({ weight_dispute_threshold_kg: 5 });
    // 3 kg difference = 6% variance: old %-based logic flagged this; kg logic must not
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ quantity_bags: 2, accepted_weight_kg: 47, declared_weight_kg: 50 }),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.weight_dispute_flag).toBe(false);
  });

  it('honors a raised kg threshold from settings', async () => {
    await setSettings({ weight_dispute_threshold_kg: 400 });
    // 300 kg difference (2.86%): under 400 kg threshold → no dispute
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({
        quantity_bags: 100,
        accepted_weight_kg: 10200,
        declared_weight_kg: 10500,
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.weight_dispute_flag).toBe(false);
  });

  it('variance above threshold kg without note → 422 WEIGHT_DISPUTE_UNRESOLVED', async () => {
    await setSettings({ weight_dispute_threshold_kg: 400 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({
        quantity_bags: 100,
        accepted_weight_kg: 10200,
        declared_weight_kg: 10700,
      }),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('WEIGHT_DISPUTE_UNRESOLVED');
  });
});

describe('Backdating guard (backdating_max_days)', () => {
  it('OPERATOR cannot backdate inbound beyond the window → 422 BACKDATING_LIMIT_EXCEEDED', async () => {
    await setSettings({ backdating_max_days: 7 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ inbound_date: daysAgo(30) }),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('BACKDATING_LIMIT_EXCEEDED');
  });

  it('MANAGER can backdate inbound beyond the window', async () => {
    await setSettings({ backdating_max_days: 7 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(managerToken),
      payload: lotPayload({ inbound_date: daysAgo(30) }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('OPERATOR can backdate inbound within the window', async () => {
    await setSettings({ backdating_max_days: 7 });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ inbound_date: daysAgo(3) }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('null backdating_max_days = unlimited (current behavior preserved)', async () => {
    await setSettings({ backdating_max_days: null });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ inbound_date: daysAgo(120) }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('OPERATOR cannot backdate an outbound beyond the window; MANAGER can', async () => {
    await setSettings({ backdating_max_days: null });
    const lotRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: lotPayload({ quantity_bags: 100, accepted_weight_kg: 2000 }),
    });
    expect(lotRes.statusCode).toBe(201);
    const lotId = JSON.parse(lotRes.body).data.id;

    await setSettings({ backdating_max_days: 7 });

    const opRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lotId,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 10,
        outbound_date: daysAgo(30),
      },
    });
    expect(opRes.statusCode).toBe(422);
    expect(JSON.parse(opRes.body).error.code).toBe('BACKDATING_LIMIT_EXCEEDED');

    const mgrRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(managerToken),
      payload: {
        lot_id: lotId,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 10,
        outbound_date: daysAgo(30),
      },
    });
    expect(mgrRes.statusCode).toBe(201);
  });
});
