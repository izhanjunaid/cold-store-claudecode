import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
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
const SERVICE_CHARGE_ID = '00000000-0000-0000-0000-000000000600';

const RATE_PLAN_MONTHLY = '00000000-0000-0000-0000-000000000500'; // existing, rate 100, minDays 1
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';
const RATE_PLAN_DAILY = '00000000-0000-0000-0000-000000000502';
const RATE_PLAN_MIN_DAYS = '00000000-0000-0000-0000-000000000503';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let accountantToken: string;
let securityToken: string;
let ownerPartyId: string;
let otherPartyId: string;
let managerUserId: string;

async function seedRatePlans() {
  await prisma.ratePlan.upsert({
    where: { id: RATE_PLAN_SEASONAL },
    update: { isActive: true },
    create: {
      id: RATE_PLAN_SEASONAL,
      facilityId: TEST_FACILITY_ID,
      name: 'Test Seasonal Rate',
      rateType: 'SEASONAL_PER_BAG',
      rateAmountPkr: 50,
      minBillingDays: 1,
      seasonStartDate: new Date('2026-01-01'),
      seasonEndDate: new Date('2026-12-31'),
      isActive: true,
    },
  });
  await prisma.ratePlan.upsert({
    where: { id: RATE_PLAN_DAILY },
    update: { isActive: true },
    create: {
      id: RATE_PLAN_DAILY,
      facilityId: TEST_FACILITY_ID,
      name: 'Test Daily Rate',
      rateType: 'DAILY_PER_BAG',
      rateAmountPkr: 10,
      minBillingDays: 1,
      isActive: true,
    },
  });
  await prisma.ratePlan.upsert({
    where: { id: RATE_PLAN_MIN_DAYS },
    update: { isActive: true },
    create: {
      id: RATE_PLAN_MIN_DAYS,
      facilityId: TEST_FACILITY_ID,
      name: 'Test Min-Days Daily Rate',
      rateType: 'DAILY_PER_BAG',
      rateAmountPkr: 10,
      minBillingDays: 7,
      isActive: true,
    },
  });
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

async function createLot(opts: {
  ratePlanId: string;
  quantity: number;
  inboundDate: string;
  ownerPartyId?: string;
}): Promise<{ id: string; lot_number: string; current_balance_bags: number }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: opts.ownerPartyId ?? ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: opts.ratePlanId,
      chamber_id: CHAMBER_A,
      quantity_bags: opts.quantity,
      accepted_weight_kg: opts.quantity * 20,
      inbound_date: opts.inboundDate,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

async function finalizeOutbound(opts: {
  lotId: string;
  quantity: number;
  outboundDate: string;
  withdrawalType?: 'FULL' | 'PARTIAL';
}): Promise<{ outboundId: string; invoiceId: string }> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: opts.lotId,
      withdrawal_type: opts.withdrawalType ?? 'FULL',
      quantity_withdrawn_bags: opts.quantity,
      outbound_date: opts.outboundDate,
    },
  });
  expect(createRes.statusCode).toBe(201);
  const outboundId = JSON.parse(createRes.body).data.id;

  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: opts.quantity * 19.5 },
  });

  const finalizeRes = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finalizeRes.statusCode).toBe(200);
  const body = JSON.parse(finalizeRes.body).data;
  expect(body.invoice_id).toBeTruthy();
  return { outboundId, invoiceId: body.invoice_id };
}

beforeAll(async () => {
  app = await getTestApp();

  await withGuardsDisabled(prisma, async () => {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });

  await seedRatePlans();

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  managerUserId = mgr.user.id;
  const acc = await loginAsRole(app, 'ACCOUNTANT');
  accountantToken = acc.accessToken;
  const sec = await loginAsRole(app, 'SECURITY');
  securityToken = sec.accessToken;

  ownerPartyId = await createParty('Invoice Owner Farmer', '03009200101');
  otherPartyId = await createParty('Invoice Other Farmer', '03009200102');
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Invoice — Billing Engine', () => {
  it('1. SEASONAL: outbound finalize auto-creates DRAFT invoice with STORAGE line', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 50,
      inboundDate: '2026-01-15',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 50,
      outboundDate: '2026-04-10',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.body).data;
    expect(inv.status).toBe('DRAFT');
    expect(inv.lot_id).toBe(lot.id);
    expect(inv.lot_number).toBe(lot.lot_number);
    expect(inv.line_items.length).toBe(1);
    const storage = inv.line_items[0];
    expect(storage.line_type).toBe('STORAGE');
    // SEASONAL: 50 × 50 = 2500, days-independent
    expect(storage.amount_pkr).toBe(2500);
    expect(inv.sub_total_pkr).toBe(2500);
    expect(inv.total_pkr).toBe(2500);
    expect(inv.balance_due_pkr).toBe(2500);
  });

  it('2. MONTHLY: 45-day period → 2 months × rate × bags', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_MONTHLY,
      quantity: 40,
      inboundDate: '2026-02-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 40,
      outboundDate: '2026-03-18', // 45 days later
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const inv = JSON.parse(res.body).data;
    // ceil(45/30) = 2 months × 40 bags × Rs.100 = 8000
    expect(inv.line_items[0].amount_pkr).toBe(8000);
    expect(inv.total_pkr).toBe(8000);
  });

  it('3. DAILY: bags × rate × days', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_DAILY,
      quantity: 30,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 30,
      outboundDate: '2026-03-16', // 15 days
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const inv = JSON.parse(res.body).data;
    // 30 × 10 × 15 = 4500
    expect(inv.line_items[0].amount_pkr).toBe(4500);
    expect(inv.total_pkr).toBe(4500);
  });

  it('4. min_billing_days floors same-day inbound/outbound to minimum', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_MIN_DAYS, // minBillingDays = 7
      quantity: 20,
      inboundDate: '2026-04-05',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 20,
      outboundDate: '2026-04-05', // same-day → floor to 7 days
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const inv = JSON.parse(res.body).data;
    // 20 × 10 × 7 = 1400
    expect(inv.line_items[0].amount_pkr).toBe(1400);
  });

  it('5. POST /v1/invoices/:id/lines adds SERVICE line and recomputes totals', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 20,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 20,
      outboundDate: '2026-04-01',
    });

    const addRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/lines`,
      headers: authHeaders(managerToken),
      payload: {
        line_type: 'SERVICE',
        description: 'Loading charge',
        quantity: 20,
        unit_price_pkr: 10,
        service_charge_id: SERVICE_CHARGE_ID,
      },
    });
    expect(addRes.statusCode).toBe(201);
    const inv = JSON.parse(addRes.body).data;
    expect(inv.line_items.length).toBe(2);
    const service = inv.line_items.find((l: any) => l.line_type === 'SERVICE');
    expect(service.amount_pkr).toBe(200); // 20 × 10
    // Seasonal storage: 20 × 50 = 1000 + 200 service = 1200
    expect(inv.sub_total_pkr).toBe(1200);
    expect(inv.total_pkr).toBe(1200);
  });

  it('6. POST ADJUSTMENT (negative) line recomputes totals', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 10,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 10,
      outboundDate: '2026-04-01',
    });

    const addRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/lines`,
      headers: authHeaders(managerToken),
      payload: {
        line_type: 'ADJUSTMENT',
        description: 'Loyalty discount',
        quantity: 1,
        unit_price_pkr: -100,
      },
    });
    expect(addRes.statusCode).toBe(201);
    const inv = JSON.parse(addRes.body).data;
    // Seasonal 10 × 50 = 500, minus 100 adjustment = 400
    expect(inv.sub_total_pkr).toBe(400);
    expect(inv.total_pkr).toBe(400);
  });

  it('7. DELETE SERVICE line succeeds; DELETE STORAGE line → 422 INVOICE_LINE_IMMUTABLE', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 15,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 15,
      outboundDate: '2026-04-01',
    });

    // Add a SERVICE line
    const addRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/lines`,
      headers: authHeaders(managerToken),
      payload: {
        line_type: 'SERVICE',
        description: 'Handling',
        quantity: 5,
        unit_price_pkr: 20,
      },
    });
    const addedInv = JSON.parse(addRes.body).data;
    const serviceLineId = addedInv.line_items.find((l: any) => l.line_type === 'SERVICE').id;
    const storageLineId = addedInv.line_items.find((l: any) => l.line_type === 'STORAGE').id;

    // Delete the SERVICE line → 200
    const delService = await app.inject({
      method: 'DELETE',
      url: `/v1/invoices/${invoiceId}/lines/${serviceLineId}`,
      headers: authHeaders(managerToken),
    });
    expect(delService.statusCode).toBe(200);
    const afterDel = JSON.parse(delService.body).data;
    expect(afterDel.line_items.length).toBe(1);

    // Attempt to delete the STORAGE line → 422
    const delStorage = await app.inject({
      method: 'DELETE',
      url: `/v1/invoices/${invoiceId}/lines/${storageLineId}`,
      headers: authHeaders(managerToken),
    });
    expect(delStorage.statusCode).toBe(422);
    expect(JSON.parse(delStorage.body).error.code).toBe('INVOICE_LINE_IMMUTABLE');
  });

  it('8. POST /v1/invoices/:id/finalize assigns INV-YYYYMM-NNNN, status FINALIZED, sets finalized_by', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 10,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 10,
      outboundDate: '2026-04-01',
    });

    const finalizeRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: { notes: 'Ready for mailing' },
    });
    expect(finalizeRes.statusCode).toBe(200);
    const inv = JSON.parse(finalizeRes.body).data;
    expect(inv.status).toBe('FINALIZED');
    expect(inv.invoice_number).toMatch(/^INV-\d{6}-\d{4}$/);
    expect(inv.finalized_at).toBeTruthy();
    expect(inv.finalized_by).toBe(managerUserId);
    expect(inv.notes).toBe('Ready for mailing');
  });

  it('9. After finalize, add/delete/finalize → 409 INVOICE_ALREADY_FINALIZED', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 10,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 10,
      outboundDate: '2026-04-01',
    });

    // capture STORAGE line id before finalize
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const storageLineId = JSON.parse(getRes.body).data.line_items[0].id;

    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    // Second finalize → 409
    const again = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('INVOICE_ALREADY_FINALIZED');

    // Add line to finalized invoice → 409
    const addAfter = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/lines`,
      headers: authHeaders(managerToken),
      payload: { line_type: 'SERVICE', description: 'X', quantity: 1, unit_price_pkr: 10 },
    });
    expect(addAfter.statusCode).toBe(409);
    expect(JSON.parse(addAfter.body).error.code).toBe('INVOICE_ALREADY_FINALIZED');

    // Delete line on finalized invoice → 409
    const delAfter = await app.inject({
      method: 'DELETE',
      url: `/v1/invoices/${invoiceId}/lines/${storageLineId}`,
      headers: authHeaders(managerToken),
    });
    expect(delAfter.statusCode).toBe(409);
    expect(JSON.parse(delAfter.body).error.code).toBe('INVOICE_ALREADY_FINALIZED');
  });

  it('10. GET /v1/invoices filters by status + party_id; GET /v1/lots/:id/invoices scoped to lot', async () => {
    // Create one lot/invoice for each of two parties
    const lotA = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 5,
      inboundDate: '2026-03-01',
      ownerPartyId,
    });
    await finalizeOutbound({ lotId: lotA.id, quantity: 5, outboundDate: '2026-04-01' });

    const lotB = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 5,
      inboundDate: '2026-03-01',
      ownerPartyId: otherPartyId,
    });
    const { invoiceId: invB } = await finalizeOutbound({
      lotId: lotB.id,
      quantity: 5,
      outboundDate: '2026-04-01',
    });

    // Filter by status=DRAFT — at least our two should be present
    const draftRes = await app.inject({
      method: 'GET',
      url: '/v1/invoices?status=DRAFT&page_size=100',
      headers: authHeaders(accountantToken),
    });
    expect(draftRes.statusCode).toBe(200);
    const draftList = JSON.parse(draftRes.body).data;
    expect(Array.isArray(draftList)).toBe(true);
    expect(draftList.every((i: any) => i.status === 'DRAFT')).toBe(true);

    // Filter by party_id=otherPartyId — should include invB, exclude lotA's invoice
    const partyRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices?party_id=${otherPartyId}`,
      headers: authHeaders(accountantToken),
    });
    expect(partyRes.statusCode).toBe(200);
    const partyList = JSON.parse(partyRes.body).data;
    expect(Array.isArray(partyList)).toBe(true);
    expect(partyList.every((i: any) => i.billing_party_id === otherPartyId)).toBe(true);
    expect(partyList.some((i: any) => i.id === invB)).toBe(true);

    // GET /v1/lots/:id/invoices scoped to lot
    const lotInvRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotB.id}/invoices`,
      headers: authHeaders(managerToken),
    });
    expect(lotInvRes.statusCode).toBe(200);
    const lotInv = JSON.parse(lotInvRes.body).data;
    expect(lotInv.length).toBe(1);
    expect(lotInv[0].id).toBe(invB);
    expect(lotInv[0].lot_id).toBe(lotB.id);
  });

  it('11. Role gating: OPERATOR forbidden on list + finalize; ACCOUNTANT lists; MANAGER finalizes', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 8,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 8,
      outboundDate: '2026-04-01',
    });

    // OPERATOR → 403 on list
    const opList = await app.inject({
      method: 'GET',
      url: '/v1/invoices',
      headers: authHeaders(operatorToken),
    });
    expect(opList.statusCode).toBe(403);

    // OPERATOR → 403 on finalize
    const opFinalize = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(operatorToken),
      payload: {},
    });
    expect(opFinalize.statusCode).toBe(403);

    // SECURITY → 403 on list
    const secList = await app.inject({
      method: 'GET',
      url: '/v1/invoices',
      headers: authHeaders(securityToken),
    });
    expect(secList.statusCode).toBe(403);

    // ACCOUNTANT → 200 on list
    const accList = await app.inject({
      method: 'GET',
      url: '/v1/invoices',
      headers: authHeaders(accountantToken),
    });
    expect(accList.statusCode).toBe(200);

    // MANAGER → 200 on finalize
    const mgrFinalize = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(mgrFinalize.statusCode).toBe(200);
  });

  it('12. GET /v1/invoices/:id/pdf returns application/pdf; duplicate outbound finalize is idempotent', async () => {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity: 12,
      inboundDate: '2026-03-01',
    });
    const { outboundId, invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 12,
      outboundDate: '2026-04-01',
    });

    const pdfRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}/pdf`,
      headers: authHeaders(managerToken),
    });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toContain('application/pdf');

    // Idempotency: re-run buildInvoiceFromOutbound for same outbound → same invoice id
    const { buildInvoiceFromOutbound } = await import('./invoice.builder');
    const rebuilt = await prisma.$transaction((tx) =>
      buildInvoiceFromOutbound(tx, outboundId),
    );
    expect(rebuilt.id).toBe(invoiceId);

    // Count invoices for this outbound must stay at 1
    const invoiceCount = await prisma.invoice.count({
      where: { outboundEventId: outboundId },
    });
    expect(invoiceCount).toBe(1);
  });
});

describe('Invoice — draft-stage discount (Phase 12)', () => {
  async function draftInvoice(quantity = 20): Promise<string> {
    const lot = await createLot({
      ratePlanId: RATE_PLAN_SEASONAL,
      quantity,
      inboundDate: '2026-03-01',
    });
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity,
      outboundDate: '2026-04-01',
    });
    return invoiceId;
  }

  it('D1. PATCH percent discount recomputes totals (MANAGER)', async () => {
    const invoiceId = await draftInvoice(20); // seasonal: 20 × 50 = 1000
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'PERCENT', value: 10 } },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.body).data;
    expect(inv.sub_total_pkr).toBe(1000);
    expect(inv.discount_type).toBe('PERCENT');
    expect(inv.discount_value).toBe(10);
    expect(inv.discount_amount_pkr).toBe(100);
    expect(inv.total_pkr).toBe(900);
    expect(inv.balance_due_pkr).toBe(900);
  });

  it('D2. PATCH fixed discount + gst_rate: GST computed on post-discount base', async () => {
    const invoiceId = await draftInvoice(20); // subtotal 1000
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { gst_rate: 10, discount: { type: 'FIXED', value: 200 } },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.body).data;
    expect(inv.discount_amount_pkr).toBe(200);
    expect(inv.gst_rate).toBe(10);
    // GST on (1000 - 200) = 80; total = 1000 - 200 + 80 = 880
    expect(inv.gst_amount_pkr).toBe(80);
    expect(inv.total_pkr).toBe(880);
  });

  it('D3. PATCH discount null clears it', async () => {
    const invoiceId = await draftInvoice(10); // subtotal 500
    await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'FIXED', value: 100 } },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: null },
    });
    expect(res.statusCode).toBe(200);
    const inv = JSON.parse(res.body).data;
    expect(inv.discount_type).toBeNull();
    expect(inv.discount_amount_pkr).toBe(0);
    expect(inv.total_pkr).toBe(500);
  });

  it('D4. ACCOUNTANT cannot PATCH a draft invoice → 403', async () => {
    const invoiceId = await draftInvoice(10);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
      payload: { discount: { type: 'PERCENT', value: 5 } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('D5. Fixed discount exceeding subtotal → 422', async () => {
    const invoiceId = await draftInvoice(10); // subtotal 500
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'FIXED', value: 600 } },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVOICE_DISCOUNT_EXCEEDS_SUBTOTAL');
  });

  it('D6. Removing a line that would push FIXED discount above subtotal → 422', async () => {
    const invoiceId = await draftInvoice(20); // storage 1000
    // add service 200 → subtotal 1200
    const addRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/lines`,
      headers: authHeaders(managerToken),
      payload: { line_type: 'SERVICE', description: 'Loading', quantity: 20, unit_price_pkr: 10 },
    });
    expect(addRes.statusCode).toBe(201);
    const serviceLineId = JSON.parse(addRes.body).data.line_items.find(
      (l: any) => l.line_type === 'SERVICE',
    ).id;

    // discount 1100 ≤ 1200 OK
    const discRes = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'FIXED', value: 1100 } },
    });
    expect(discRes.statusCode).toBe(200);

    // removing the 200 line would make subtotal 1000 < discount 1100 → reject
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/v1/invoices/${invoiceId}/lines/${serviceLineId}`,
      headers: authHeaders(managerToken),
    });
    expect(delRes.statusCode).toBe(422);
    expect(JSON.parse(delRes.body).error.code).toBe('INVOICE_DISCOUNT_EXCEEDS_SUBTOTAL');
  });

  it('D7. PATCH after finalize → 409', async () => {
    const invoiceId = await draftInvoice(10);
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'PERCENT', value: 5 } },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('INVOICE_ALREADY_FINALIZED');
  });

  it('G1. GST default rate prefills invoice when facility is GST-registered', async () => {
    const facility = await prisma.facility.findUnique({
      where: { id: TEST_FACILITY_ID },
      select: { settings: true },
    });
    const original = (facility?.settings ?? {}) as Record<string, unknown>;
    try {
      await prisma.facility.update({
        where: { id: TEST_FACILITY_ID },
        data: { settings: { ...original, gst_registered: true, gst_default_rate: 17 } as never },
      });
      const invoiceId = await draftInvoice(20); // subtotal 1000
      const res = await app.inject({
        method: 'GET',
        url: `/v1/invoices/${invoiceId}`,
        headers: authHeaders(managerToken),
      });
      const inv = JSON.parse(res.body).data;
      expect(inv.gst_rate).toBe(17);
      expect(inv.gst_amount_pkr).toBe(170);
      expect(inv.total_pkr).toBe(1170);
    } finally {
      await prisma.facility.update({
        where: { id: TEST_FACILITY_ID },
        data: { settings: original as never },
      });
    }
  });

  it('G2. GST stays 0 when facility is not GST-registered', async () => {
    const invoiceId = await draftInvoice(10);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const inv = JSON.parse(res.body).data;
    expect(inv.gst_rate).toBe(0);
    expect(inv.gst_amount_pkr).toBe(0);
  });

  it('D8. Finalizing a discounted invoice posts DR 4910 in JE-01', async () => {
    const invoiceId = await draftInvoice(20); // subtotal 1000
    await app.inject({
      method: 'PATCH',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
      payload: { discount: { type: 'PERCENT', value: 10 } }, // 100
    });
    const finRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(finRes.statusCode).toBe(200);

    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { journalEntryId: true },
    });
    expect(inv?.journalEntryId).toBeTruthy();
    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: inv!.journalEntryId! },
    });
    const discountLine = lines.find((l) => l.accountCode === '4910');
    expect(discountLine).toBeDefined();
    expect(Number(discountLine!.debitAmount)).toBe(100);
    // AR debit is net of discount
    const arLine = lines.find((l) => l.accountCode === '1110');
    expect(Number(arLine!.debitAmount)).toBe(900);
    // revenue credited gross
    const revLine = lines.find((l) => l.accountCode === '4010');
    expect(Number(revLine!.creditAmount)).toBe(1000);
    // balanced
    const d = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const c = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(d).toBeCloseTo(c);
  });
});

describe('Party GET — over_credit_limit (credit exposure)', () => {
  // OPERATOR (and lower roles) can read this endpoint, but AR totals are
  // ACCOUNTANT+ only (billing.view) — so the response must expose a boolean
  // flag for the withdrawal-screen warning, never the outstanding_pkr figure.
  it('reports over_credit_limit=true when unpaid finalized invoices exceed the limit, without exposing the outstanding amount', async () => {
    const partyRes = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Credit Check Party',
        party_type: 'FARMER',
        phone_primary: '03009300101',
        credit_terms_days: 30,
        credit_limit_pkr: 1500,
      },
    });
    expect(partyRes.statusCode).toBe(201);
    const creditPartyId = JSON.parse(partyRes.body).data.id as string;

    const lot = await createLot({
      ratePlanId: RATE_PLAN_MONTHLY, // 100/bag/month
      quantity: 20,
      inboundDate: '2026-01-01',
      ownerPartyId: creditPartyId,
    });
    // Jan 1 -> Feb 1 = 31 days -> ceil(31/30) = 2 months: 20 * 100 * 2 = 4000
    const { invoiceId } = await finalizeOutbound({
      lotId: lot.id,
      quantity: 20,
      outboundDate: '2026-02-01',
    });
    // getOutstandingPkr only counts FINALIZED invoices; the dispatch-created
    // invoice starts DRAFT until explicitly finalized.
    const invFinalize = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(invFinalize.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/parties/${creditPartyId}`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.credit_limit_pkr).toBe(1500);
    expect(body.over_credit_limit).toBe(true);
    expect(body.outstanding_pkr).toBeUndefined();

    // Paying down below the limit clears the flag.
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: creditPartyId,
        payment_date: '2026-02-05',
        amount_pkr: 3000,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: 3000 }],
      },
    });
    expect(payRes.statusCode).toBe(201);

    const res2 = await app.inject({
      method: 'GET',
      url: `/v1/parties/${creditPartyId}`,
      headers: authHeaders(operatorToken),
    });
    expect(JSON.parse(res2.body).data.over_credit_limit).toBe(false);
  });

  it('over_credit_limit is false when a credit limit is set but there is no outstanding balance', async () => {
    const partyRes = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Under Limit Party',
        party_type: 'FARMER',
        phone_primary: '03009300103',
        credit_terms_days: 30,
        credit_limit_pkr: 5000,
      },
    });
    const partyId = JSON.parse(partyRes.body).data.id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/parties/${partyId}`,
      headers: authHeaders(operatorToken),
    });
    expect(JSON.parse(res.body).data.over_credit_limit).toBe(false);
  });

  it('omits over_credit_limit for a party with no credit limit set', async () => {
    const partyRes = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'No Limit Party',
        party_type: 'FARMER',
        phone_primary: '03009300102',
        credit_terms_days: 30,
      },
    });
    const partyId = JSON.parse(partyRes.body).data.id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/parties/${partyId}`,
      headers: authHeaders(operatorToken),
    });
    expect(JSON.parse(res.body).data.over_credit_limit).toBeUndefined();
  });
});
