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
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let ownerPartyId: string;
let receivingPartyId: string;

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
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data as {
    id: string;
    lot_number: string;
    current_balance_bags: number;
  };
}

async function createParty(name: string, phone: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name,
      party_type: 'BUYER',
      phone_primary: phone,
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id;
}

beforeAll(async () => {
  app = await getTestApp();

  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;

  ownerPartyId = await createParty('Outbound Owner Farmer', '03009100101');
  receivingPartyId = await createParty('Outbound Receiver Buyer', '03009100102');
});

afterAll(async () => {
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Outbound Events', () => {
  it('1. Create PARTIAL withdrawal: status PENDING, lot balance unchanged', async () => {
    const lot = await createLot(100);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 30,
        outbound_date: '2026-04-20',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body).data;
    expect(body.status).toBe('PENDING');
    expect(body.withdrawal_type).toBe('PARTIAL');
    expect(body.quantity_withdrawn_bags).toBe(30);
    expect(body.dispatch_note_number).toMatch(/^DN-/);

    // Lot balance not yet decremented
    const dbLot = await prisma.lot.findUnique({ where: { id: lot.id } });
    expect(dbLot?.currentBalanceBags).toBe(100);
  });

  it('2. Create FULL withdrawal: status PENDING, qty equals balance', async () => {
    const lot = await createLot(50);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: 50,
        outbound_date: '2026-04-20',
        receiving_party_id: receivingPartyId,
        vehicle_number: 'ABC-1234',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body).data;
    expect(body.status).toBe('PENDING');
    expect(body.withdrawal_type).toBe('FULL');
    expect(body.quantity_withdrawn_bags).toBe(50);
    expect(body.receiving_party_name).toBeTruthy();
    expect(body.vehicle_number).toBe('ABC-1234');
  });

  it('3. Reject FULL withdrawal when qty != balance', async () => {
    const lot = await createLot(60);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: 59,
        outbound_date: '2026-04-20',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('4. Reject PARTIAL when qty >= balance', async () => {
    const lot = await createLot(40);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 40,
        outbound_date: '2026-04-20',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('LOT_BALANCE_INSUFFICIENT');
  });

  it('5. Reject withdrawal on CLOSED lot', async () => {
    const lot = await createLot(20);
    await prisma.lot.update({ where: { id: lot.id }, data: { status: 'CLOSED' } });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: 20,
        outbound_date: '2026-04-20',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('LOT_NOT_ACTIVE');
  });

  it('6. GET by ID returns correct data', async () => {
    const lot = await createLot(80);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 25,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/outbound-events/${eventId}`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.id).toBe(eventId);
    expect(body.lot_number).toBeTruthy();
    expect(body.quantity_withdrawn_bags).toBe(25);
  });

  it('7. Record weight: status → WEIGHED, variance calculated', async () => {
    const lot = await createLot(100);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 50,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    const weightRes = await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${eventId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 980 },
    });
    expect(weightRes.statusCode).toBe(200);
    const body = JSON.parse(weightRes.body).data;
    expect(body.status).toBe('WEIGHED');
    expect(body.outbound_weight_kg).toBe(980);
    expect(body.prorated_inbound_weight_kg).not.toBeNull();
    expect(body.weight_variance_pct).not.toBeNull();
  });

  it('8. Finalize: status → DISPATCHED, lot balance decremented', async () => {
    const lot = await createLot(100);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 30,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    // Record weight first
    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${eventId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 600 },
    });

    const finalizeRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${eventId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(finalizeRes.statusCode).toBe(200);
    const body = JSON.parse(finalizeRes.body).data;
    expect(body.status).toBe('DISPATCHED');

    const dbLot = await prisma.lot.findUnique({ where: { id: lot.id } });
    expect(dbLot?.currentBalanceBags).toBe(70); // 100 - 30
    expect(dbLot?.status).toBe('ACTIVE'); // partial, not closed
  });

  it('9. FULL finalize closes the lot', async () => {
    const lot = await createLot(40);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: 40,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${eventId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 800 },
    });

    const finalizeRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${eventId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(finalizeRes.statusCode).toBe(200);

    const dbLot = await prisma.lot.findUnique({ where: { id: lot.id } });
    expect(dbLot?.currentBalanceBags).toBe(0);
    expect(dbLot?.status).toBe('CLOSED');
    expect(dbLot?.closedAt).not.toBeNull();
  });

  it('10. Reject finalize without weight (status PENDING)', async () => {
    const lot = await createLot(60);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 20,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${eventId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('OUTBOUND_WEIGHT_REQUIRED');
  });

  it('11. Role gating: OPERATOR cannot finalize (403)', async () => {
    const lot = await createLot(50);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 10,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${eventId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 200 },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${eventId}/finalize`,
      headers: authHeaders(operatorToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('12. Dispatch note PDF endpoint returns application/pdf', async () => {
    const lot = await createLot(70);
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 15,
        outbound_date: '2026-04-20',
      },
    });
    const eventId = JSON.parse(createRes.body).data.id;

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/v1/outbound-events/${eventId}/dispatch-note`,
      headers: authHeaders(operatorToken),
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.rawPayload.length).toBeGreaterThan(0);
  });

  it('13. GET /lots/:id/outbound-events returns lot withdrawals', async () => {
    const lot = await createLot(90);
    await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lot.id,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 10,
        outbound_date: '2026-04-20',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lot.id}/outbound-events`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const events = JSON.parse(res.body).data as Array<{ lot_id: string }>;
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.lot_id).toBe(lot.id);
  });
});
