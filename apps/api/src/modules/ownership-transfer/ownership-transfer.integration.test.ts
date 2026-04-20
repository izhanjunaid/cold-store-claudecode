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
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let fromPartyId: string;
let toPartyId: string;
let altPartyId: string;

async function createLot(quantity = 100) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: fromPartyId,
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
      party_type: 'FARMER',
      phone_primary: phone,
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id;
}

beforeAll(async () => {
  app = await getTestApp();

  // Clean slate
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;

  fromPartyId = await createParty('Transfer From Farmer', '03009000101');
  toPartyId = await createParty('Transfer To Trader', '03009000102');
  altPartyId = await createParty('Alt Party', '03009000103');
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

describe('Ownership Transfer', () => {
  it('FULL transfer: updates owner, writes TRANSFER_OUT event, balance unchanged', async () => {
    const lot = await createLot(80);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: toPartyId,
        effective_date: '2026-04-15',
        notes: 'sale to trader',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.transfer_type).toBe('FULL');
    expect(body.data.parent_current_balance_bags).toBe(80);
    expect(body.data.child_lot_id).toBeNull();

    // Verify DB state
    const dbLot = await prisma.lot.findUnique({ where: { id: lot.id } });
    expect(dbLot?.ownerPartyId).toBe(toPartyId);
    expect(dbLot?.billingPartyId).toBe(toPartyId);
    expect(dbLot?.currentBalanceBags).toBe(80);

    const events = await prisma.ownershipHistory.findMany({ where: { lotId: lot.id } });
    expect(events.find((e) => e.eventType === 'TRANSFER_OUT')).toBeDefined();
  });

  it('PARTIAL transfer: creates child lot with -T1 suffix, decrements parent, writes two events', async () => {
    const lot = await createLot(50);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: toPartyId,
        quantity_bags: 10,
        effective_date: '2026-04-15',
        transfer_price_pkr: 15000,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.parent_current_balance_bags).toBe(40);
    expect(body.data.child_lot_number).toBe(`${lot.lot_number}-T1`);

    // Parent has TRANSFER_OUT
    const parentEvents = await prisma.ownershipHistory.findMany({ where: { lotId: lot.id } });
    expect(parentEvents.find((e) => e.eventType === 'TRANSFER_OUT')).toBeDefined();

    // Child lot has TRANSFER_IN + correct fields
    const child = await prisma.lot.findFirst({ where: { parentLotId: lot.id } });
    expect(child).not.toBeNull();
    expect(child?.currentBalanceBags).toBe(10);
    expect(child?.quantityBags).toBe(10);
    expect(child?.ownerPartyId).toBe(toPartyId);

    const childEvents = await prisma.ownershipHistory.findMany({ where: { lotId: child!.id } });
    expect(childEvents.find((e) => e.eventType === 'TRANSFER_IN')).toBeDefined();
  });

  it('Second PARTIAL on same parent yields -T2', async () => {
    const lot = await createLot(60);

    const r1 = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: toPartyId,
        quantity_bags: 15,
        effective_date: '2026-04-15',
      },
    });
    expect(r1.statusCode).toBe(201);
    expect(JSON.parse(r1.body).data.child_lot_number).toBe(`${lot.lot_number}-T1`);

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: altPartyId,
        quantity_bags: 20,
        effective_date: '2026-04-15',
      },
    });
    expect(r2.statusCode).toBe(201);
    const body2 = JSON.parse(r2.body);
    expect(body2.data.child_lot_number).toBe(`${lot.lot_number}-T2`);
    expect(body2.data.parent_current_balance_bags).toBe(25); // 60 - 15 - 20
  });

  it('Rejects PARTIAL when quantity >= balance', async () => {
    const lot = await createLot(30);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: toPartyId,
        quantity_bags: 30,
        effective_date: '2026-04-15',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('Rejects transfer to the same party as current owner', async () => {
    const lot = await createLot(25);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: fromPartyId, // same as current owner
        effective_date: '2026-04-15',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('TRANSFER_SAME_PARTY');
  });

  it('Rejects transfer on CLOSED lot', async () => {
    const lot = await createLot(20);
    await prisma.lot.update({ where: { id: lot.id }, data: { status: 'CLOSED' } });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: toPartyId,
        effective_date: '2026-04-15',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('LOT_CLOSED');
  });

  it('OPERATOR forbidden (403); MANAGER allowed (201)', async () => {
    const lot = await createLot(40);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(operatorToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: toPartyId,
        effective_date: '2026-04-15',
      },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: toPartyId,
        effective_date: '2026-04-15',
      },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('Acknowledgment PDF endpoint returns application/pdf', async () => {
    const lot = await createLot(45);
    const transferRes = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: toPartyId,
        quantity_bags: 12,
        effective_date: '2026-04-15',
      },
    });
    expect(transferRes.statusCode).toBe(201);
    const transferId = JSON.parse(transferRes.body).data.transfer_id;

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lot.id}/transfer/${transferId}/acknowledgment`,
      headers: authHeaders(managerToken),
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.rawPayload.length).toBeGreaterThan(0);
  });

  it('Ownership history endpoint surfaces TRANSFER_OUT rows', async () => {
    const lot = await createLot(35);
    await app.inject({
      method: 'POST',
      url: `/v1/lots/${lot.id}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: toPartyId,
        quantity_bags: 5,
        effective_date: '2026-04-15',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lot.id}/ownership-history`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const events = JSON.parse(res.body).data as Array<{ event_type: string }>;
    expect(events.some((e) => e.event_type === 'INITIAL')).toBe(true);
    expect(events.some((e) => e.event_type === 'TRANSFER_OUT')).toBe(true);
  });
});
