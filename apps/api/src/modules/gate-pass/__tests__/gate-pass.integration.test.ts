import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
let testPartyId: string;

async function cleanup() {
  await prisma.gatePass.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.paymentAllocation.deleteMany({
    where: { payment: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoice: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.invoice.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { journalEntryId: null },
  });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({
    where: { lot: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.lot.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { status: 'ACTIVE' },
  });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({
    where: { facilityId: TEST_FACILITY_ID },
  });
  await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

async function createLot(quantity = 100): Promise<{ id: string; lot_number: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: testPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: quantity,
      accepted_weight_kg: quantity * 20,
      inbound_date: '2026-04-10',
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

async function createOutbound(lotId: string, vehicleNumber: string): Promise<{ id: string; invoice_id: string }> {
  const create = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: 100,
      outbound_date: '2026-09-01',
      vehicle_number: vehicleNumber,
    },
  });
  expect(create.statusCode).toBe(201);
  const outboundId = JSON.parse(create.body).data.id;
  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 1950 },
  });
  const fin = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  const invoiceId = JSON.parse(fin.body).data.invoice_id;
  expect(invoiceId).toBeTruthy();
  return { id: outboundId, invoice_id: invoiceId };
}

async function finalizeAndPayInvoice(invoiceId: string) {
  const fin = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${invoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  const total = Number(JSON.parse(fin.body).data.total_pkr);

  const pay = await app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(accountantToken),
    payload: {
      party_id: testPartyId,
      payment_date: '2026-09-01',
      amount_pkr: total,
      payment_method: 'CASH',
      allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: total }],
    },
  });
  expect(pay.statusCode).toBe(201);
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;

  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: `Gate-Farmer-${Date.now()}`,
      party_type: 'FARMER',
      phone_primary: `0301${Date.now()}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  testPartyId = JSON.parse(partyRes.body).data.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

describe('Phase 9 — Gate Pass (M10)', () => {
  it('SECURITY logs inward pass with GP-YYMMDD-NNNN format', async () => {
    await cleanup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'lhr-1111', driver_name: 'Ali', bilty_number: 'BLT-1' },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.pass_number).toMatch(/^GP-\d{6}-\d{4}$/);
    expect(data.vehicle_number).toBe('LHR-1111'); // upper-cased
    expect(data.direction).toBe('INWARD');
    expect(data.status).toBe('ARRIVED');
    expect(data.cleared_at).toBeNull();
    expect(data.turnaround_seconds).toBeNull();
  });

  it('OPERATOR can link inward pass to a lot, status transitions to WEIGHING', async () => {
    await cleanup();
    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-2222' },
    });
    const passId = JSON.parse(inward.body).data.id;
    const lot = await createLot(50);

    const link = await app.inject({
      method: 'PATCH',
      url: `/v1/gate-passes/${passId}/link-lot`,
      headers: authHeaders(operatorToken),
      payload: { lot_id: lot.id },
    });
    expect(link.statusCode).toBe(200);
    const data = JSON.parse(link.body).data;
    expect(data.status).toBe('WEIGHING');
    expect(data.related_lot_id).toBe(lot.id);
    expect(data.related_lot_number).toBe(lot.lot_number);
  });

  it('SECURITY cannot link-lot (OPERATOR+ required)', async () => {
    await cleanup();
    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-3333' },
    });
    const passId = JSON.parse(inward.body).data.id;
    const lot = await createLot(50);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/gate-passes/${passId}/link-lot`,
      headers: authHeaders(securityToken),
      payload: { lot_id: lot.id },
    });
    expect(res.statusCode).toBe(403);
  });

  it('clears outward when invoice is PAID — turnaround_seconds is recorded', async () => {
    await cleanup();
    const lot = await createLot(100);
    const ob = await createOutbound(lot.id, 'LHR-4444');
    await finalizeAndPayInvoice(ob.invoice_id);

    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-4444' },
    });
    const passId = JSON.parse(inward.body).data.id;

    // Sleep ~1.05s so turnaround_seconds is at least 1
    await new Promise((r) => setTimeout(r, 1050));

    const out = await app.inject({
      method: 'POST',
      url: `/v1/gate-passes/${passId}/outward`,
      headers: authHeaders(securityToken),
      payload: { outbound_event_id: ob.id },
    });
    expect(out.statusCode).toBe(200);
    const data = JSON.parse(out.body).data;
    expect(data.status).toBe('CLEARED');
    expect(data.cleared_at).toBeTruthy();
    expect(data.turnaround_seconds).toBeGreaterThan(0);
    expect(data.related_outbound_id).toBe(ob.id);
  });

  it('blocks outward when invoice is FINALIZED but unpaid', async () => {
    await cleanup();
    const lot = await createLot(100);
    const ob = await createOutbound(lot.id, 'LHR-5555');
    // Finalize but DON'T pay
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${ob.invoice_id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-5555' },
    });
    const passId = JSON.parse(inward.body).data.id;

    const out = await app.inject({
      method: 'POST',
      url: `/v1/gate-passes/${passId}/outward`,
      headers: authHeaders(securityToken),
      payload: { outbound_event_id: ob.id },
    });
    expect(out.statusCode).toBe(422);
    expect(JSON.parse(out.body).error.code).toBe('GATE_OUTWARD_BLOCKED');
  });

  it('allows outward with credit_authorization=true when caller is MANAGER', async () => {
    await cleanup();
    const lot = await createLot(100);
    const ob = await createOutbound(lot.id, 'LHR-6666');
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${ob.invoice_id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-6666' },
    });
    const passId = JSON.parse(inward.body).data.id;

    const out = await app.inject({
      method: 'POST',
      url: `/v1/gate-passes/${passId}/outward`,
      headers: authHeaders(managerToken),
      payload: { outbound_event_id: ob.id, credit_authorization: true },
    });
    expect(out.statusCode).toBe(200);
    expect(JSON.parse(out.body).data.status).toBe('CLEARED');
  });

  it('rejects credit_authorization from SECURITY (MANAGER+ only)', async () => {
    await cleanup();
    const lot = await createLot(100);
    const ob = await createOutbound(lot.id, 'LHR-7777');
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${ob.invoice_id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const inward = await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-7777' },
    });
    const passId = JSON.parse(inward.body).data.id;

    const out = await app.inject({
      method: 'POST',
      url: `/v1/gate-passes/${passId}/outward`,
      headers: authHeaders(securityToken),
      payload: { outbound_event_id: ob.id, credit_authorization: true },
    });
    expect(out.statusCode).toBe(403);
    expect(JSON.parse(out.body).error.code).toBe('GATE_CREDIT_AUTH_REQUIRES_MANAGER');
  });

  it('GET /v1/gate-passes lists active passes (status ARRIVED|WEIGHING)', async () => {
    await cleanup();
    await app.inject({
      method: 'POST',
      url: '/v1/gate-passes/inward',
      headers: authHeaders(securityToken),
      payload: { vehicle_number: 'LHR-8888' },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/v1/gate-passes?active=true',
      headers: authHeaders(securityToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((p: any) => ['ARRIVED', 'WEIGHING'].includes(p.status))).toBe(true);
  });
});
