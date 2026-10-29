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

import { renderStorageReceipt } from '../pdf/pdf.service';

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const APPLE_ID = '00000000-0000-0000-0000-000000000101';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200'; // unrestricted, 1000 bags
const CHAMBER_B = '00000000-0000-0000-0000-000000000201'; // POTATO-only, 500 bags
const CHAMBER_C = '00000000-0000-0000-0000-000000000202'; // tiny, 10 bags
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

function baseLot(overrides: Record<string, unknown> = {}) {
  return {
    owner_party_id: '', // filled in beforeAll
    commodity_id: POTATO_ID,
    rate_plan_id: RATE_PLAN,
    chamber_id: CHAMBER_A,
    quantity_bags: 100,
    accepted_weight_kg: 2000,
    ...overrides,
  };
}

let app: FastifyInstance;
let ownerToken: string;
let operatorToken: string;
let managerToken: string;
let securityToken: string;
let ownerPartyId: string;
let inactivePartyId: string;

beforeAll(async () => {
  app = await getTestApp();

  // Clean up lots from prior test runs so chamber capacity isn't exhausted
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });

  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  const sec = await loginAsRole(app, 'SECURITY');
  securityToken = sec.accessToken;

  // Create owner party
  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: 'Ghulam Hussain',
      party_type: 'FARMER',
      phone_primary: '03009000001',
      credit_terms_days: 30,
    },
  });
  ownerPartyId = JSON.parse(partyRes.body).data.id;

  // Create an inactive party for the inactive-owner test
  const inactiveRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: 'Inactive Party',
      party_type: 'FARMER',
      phone_primary: '03009000002',
      credit_terms_days: 30,
    },
  });
  inactivePartyId = JSON.parse(inactiveRes.body).data.id;

  // Deactivate it
  await app.inject({
    method: 'DELETE',
    url: `/v1/parties/${inactivePartyId}`,
    headers: authHeaders(ownerToken),
  });
});

afterAll(async () => {
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Lot CRUD & inbound workflow', () => {
  let createdLotId: string;
  let createdLotNumber: string;

  it('POST /v1/lots — OPERATOR creates lot, lot_number matches pattern', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.lot_number).toMatch(/^LOT-\d{6}-\d{4}$/);
    expect(body.data.current_balance_bags).toBe(100);
    expect(body.data.quantity_bags).toBe(100);
    expect(body.data.status).toBe('ACTIVE');
    createdLotId = body.data.id;
    createdLotNumber = body.data.lot_number;
  });

  it('POST /v1/lots — sequential creates on same day increment sequence', async () => {
    const create = () =>
      app.inject({
        method: 'POST',
        url: '/v1/lots',
        headers: authHeaders(operatorToken),
        payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 50 }),
      });

    const r1 = await create();
    const r2 = await create();
    const r3 = await create();

    const n1 = JSON.parse(r1.body).data.lot_number as string;
    const n2 = JSON.parse(r2.body).data.lot_number as string;
    const n3 = JSON.parse(r3.body).data.lot_number as string;

    const seq = (n: string) => parseInt(n.split('-')[2]!, 10);
    expect(seq(n2)).toBe(seq(n1) + 1);
    expect(seq(n3)).toBe(seq(n2) + 1);
  });

  it('POST /v1/lots — 5 concurrent creates → all succeed with unique lot numbers', async () => {
    const creates = Array.from({ length: 5 }, () =>
      app.inject({
        method: 'POST',
        url: '/v1/lots',
        headers: authHeaders(operatorToken),
        payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 10 }),
      }),
    );
    const results = await Promise.all(creates);
    const successes = results.filter((r) => r.statusCode === 201);
    const numbers = successes.map((r) => JSON.parse(r.body).data.lot_number as string);
    const unique = new Set(numbers);
    // All should succeed (advisory lock + retry handles concurrency)
    expect(successes.length).toBe(5);
    expect(unique.size).toBe(5);
  });

  it('POST /v1/lots — stores and echoes marka', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 10, marka: 'ABC FARMS' }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.marka).toBe('ABC FARMS');
  });

  it('POST /v1/lots — marka is null when omitted', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 10 }),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.marka).toBeNull();
  });

  it('GET /v1/lots?marka= — case-insensitive prefix filter', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 5, marka: 'ZZTOP-MARK' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots?marka=zztop',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ marka: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((l) => (l.marka ?? '').toUpperCase().startsWith('ZZTOP'))).toBe(true);
  });

  it('GET /v1/lots?search= — matches by owner party name', async () => {
    const partyRes = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Search Owner Zzyx',
        party_type: 'FARMER',
        phone_primary: '03009000099',
        credit_terms_days: 30,
      },
    });
    const searchPartyId = JSON.parse(partyRes.body).data.id;
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: searchPartyId, quantity_bags: 3 }),
    });
    expect(createRes.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots?search=zzyx',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ owner_party_name: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((l) => (l.owner_party_name ?? '').toLowerCase().includes('zzyx'))).toBe(true);
  });

  it('GET /v1/lots?search= — matches by vehicle number', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 3, vehicle_number: 'LEB-9988' }),
    });
    expect(createRes.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots?search=leb-9988',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ vehicle_number: string | null }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((l) => (l.vehicle_number ?? '').toLowerCase().includes('leb-9988'))).toBe(true);
  });

  it('PATCH /v1/lots/:id — updates marka', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: ownerPartyId, quantity_bags: 5 }),
    });
    const id = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/lots/${id}`,
      headers: authHeaders(operatorToken),
      payload: { marka: 'CORRECTED-MARK' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.marka).toBe('CORRECTED-MARK');
  });

  it('POST /v1/lots — weight dispute without note → 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({
        owner_party_id: ownerPartyId,
        accepted_weight_kg: 10200,
        declared_weight_kg: 10500, // >2% variance
      }),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('WEIGHT_DISPUTE_UNRESOLVED');
  });

  it('POST /v1/lots — weight dispute with note → 201, flag=true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({
        owner_party_id: ownerPartyId,
        accepted_weight_kg: 10200,
        declared_weight_kg: 10500,
        weight_dispute_note: 'Moisture loss in transit',
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.weight_dispute_flag).toBe(true);
    expect(body.data.weight_dispute_note).toBe('Moisture loss in transit');
  });

  it('POST /v1/lots — chamber commodity restriction mismatch → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({
        owner_party_id: ownerPartyId,
        chamber_id: CHAMBER_B, // POTATO-only
        commodity_id: APPLE_ID, // APPLE → mismatch
      }),
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /v1/lots — capacity overflow → 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({
        owner_party_id: ownerPartyId,
        chamber_id: CHAMBER_C, // tiny 10-bag chamber
        quantity_bags: 20, // exceeds capacity
      }),
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('CHAMBER_CAPACITY_EXCEEDED');
  });

  it('POST /v1/lots — inactive owner party → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: baseLot({ owner_party_id: inactivePartyId }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/lots — SECURITY role cannot create → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(securityToken),
      payload: baseLot({ owner_party_id: ownerPartyId }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /v1/lots — lists with status filter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/lots?status=ACTIVE',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    for (const lot of body.data) {
      expect(lot.status).toBe('ACTIVE');
    }
  });

  it('GET /v1/lots/:id — returns joined fields + days_in_storage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/lots/${createdLotId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(createdLotId);
    expect(body.data.lot_number).toBe(createdLotNumber);
    expect(body.data.owner_party_name).toBe('Ghulam Hussain');
    expect(body.data.commodity_name).toBe('POTATO');
    expect(body.data.chamber_name).toBe('Test Chamber A');
    expect(typeof body.data.days_in_storage).toBe('number');
    expect(body.data.days_in_storage).toBeGreaterThanOrEqual(0);
  });

  it('GET /v1/lots/:id/ownership-history — returns INITIAL event', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/lots/${createdLotId}/ownership-history`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const initial = body.data.find((e: { event_type: string }) => e.event_type === 'INITIAL');
    expect(initial).toBeDefined();
    expect(initial.from_party_id).toBeNull();
    expect(initial.quantity_bags).toBe(100);
  });

  it('PATCH /v1/lots/:id — updates notes only', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/lots/${createdLotId}`,
      headers: authHeaders(operatorToken),
      payload: { notes: 'Updated note', quality_grade_inbound: 'B' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.notes).toBe('Updated note');
    expect(body.data.quality_grade_inbound).toBe('B');
  });

  it('GET /v1/lots/:id/receipt — returns application/pdf', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/lots/${createdLotId}/receipt`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });
});

// Weight optional (docs/27): a lot may come in with no weight, and a facility may hide weights.
describe('Weight optional', () => {
  async function storeHideWeights(value: boolean | undefined) {
    const f = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
    const { hide_weights: _old, ...rest } = (f.settings ?? {}) as Record<string, unknown>;
    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: { settings: (value === undefined ? rest : { ...rest, hide_weights: value }) as never },
    });
  }
  const createLot = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/v1/lots', headers: authHeaders(operatorToken), payload });
  // Small lots: the file's earlier tests fill most of room A.
  const unweighedLot = (extra: Record<string, unknown> = {}) => {
    const { accepted_weight_kg: _none, ...lot } = baseLot({ owner_party_id: ownerPartyId, quantity_bags: 5, ...extra });
    return lot;
  };
  const lastReceipt = () => vi.mocked(renderStorageReceipt).mock.calls.at(-1)![0];
  const printReceipt = (lotId: string) =>
    app.inject({ method: 'GET', url: `/v1/lots/${lotId}/receipt`, headers: authHeaders(operatorToken) });

  it('a lot books with no weight', async () => {
    const res = await createLot(unweighedLot());
    expect(res.statusCode, res.body).toBe(201);
    const lot = JSON.parse(res.body).data;
    expect(lot.accepted_weight_kg).toBeNull();
    // Stored as 0, "not weighed": the column stays NOT NULL, so an older image can still read it.
    const row = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id }, select: { acceptedWeightKg: true } });
    expect(Number(row.acceptedWeightKg)).toBe(0);

    expect((await printReceipt(lot.id)).statusCode).toBe(200);
    expect(lastReceipt()).toMatchObject({ acceptedWeightKg: null, declaredWeightKg: null });
  });

  it('a declared weight alone raises no dispute', async () => {
    const res = await createLot(unweighedLot({ declared_weight_kg: 4120 }));
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body).data.weight_dispute_flag).toBe(false);
  });

  it('with weights hidden the parchi carries no weight, and the stored one is kept', async () => {
    const res = await createLot(
      baseLot({
        owner_party_id: ownerPartyId,
        quantity_bags: 5,
        accepted_weight_kg: 4000,
        declared_weight_kg: 4120,
        weight_dispute_note: 'Declared 4,120 kg, kanta 4,000 kg',
      }),
    );
    expect(res.statusCode, res.body).toBe(201);
    const lotId = JSON.parse(res.body).data.id;

    await storeHideWeights(true);
    try {
      expect((await printReceipt(lotId)).statusCode).toBe(200);
      expect(lastReceipt()).toMatchObject({
        acceptedWeightKg: null,
        declaredWeightKg: null,
        weightDisputeFlag: false,
        weightDisputeNote: null,
      });
    } finally {
      await storeHideWeights(undefined);
    }
    const row = await prisma.lot.findUniqueOrThrow({ where: { id: lotId }, select: { acceptedWeightKg: true } });
    expect(Number(row.acceptedWeightKg)).toBe(4000);
  });
});
