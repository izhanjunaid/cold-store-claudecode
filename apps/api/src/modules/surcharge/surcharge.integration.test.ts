import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let accountantToken: string;
let ownerPartyId: string;
let originalSettings: unknown;

function daysAgoDate(n: number): Date {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function setSurchargeRule(rule: { enabled: boolean; pct_per_month: number; grace_days: number }) {
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
    data: { settings: { ...cur, late_payment_surcharge: rule } as never },
  });
}

/** Create lot → outbound → finalized invoice, then backdate invoice_date. */
async function overdueInvoice(daysOverdue: number): Promise<string> {
  const lotRes = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL, // seasonal: 50/bag
      chamber_id: CHAMBER_A,
      quantity_bags: 20,
      accepted_weight_kg: 400,
      inbound_date: '2026-01-15',
    },
  });
  expect(lotRes.statusCode).toBe(201);
  const lotId = JSON.parse(lotRes.body).data.id;

  const obRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: 20,
      outbound_date: '2026-02-15',
    },
  });
  expect(obRes.statusCode).toBe(201);
  const outboundId = JSON.parse(obRes.body).data.id;
  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 390 },
  });
  const finRes = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finRes.statusCode).toBe(200);
  const invoiceId = JSON.parse(finRes.body).data.invoice_id as string;

  const invFin = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${invoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(invFin.statusCode).toBe(200);

  // Backdate the invoice so it is overdue
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { invoiceDate: daysAgoDate(daysOverdue) },
  });
  return invoiceId;
}

beforeAll(async () => {
  app = await getTestApp();

  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceSurcharge.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
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

  // Seasonal rate plan (mirrors invoice.integration.test.ts)
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

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  const acc = await loginAsRole(app, 'ACCOUNTANT');
  accountantToken = acc.accessToken;

  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: 'Surcharge Test Trader',
      party_type: 'TRADER',
      phone_primary: '03009300101',
      credit_terms_days: 30,
    },
  });
  ownerPartyId = JSON.parse(partyRes.body).data.id;

  await setSurchargeRule({ enabled: true, pct_per_month: 2, grace_days: 30 });
});

afterAll(async () => {
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: (originalSettings ?? {}) as never },
  });
  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceSurcharge.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Late payment surcharge (Phase 12)', () => {
  it('S1. suggestions list the overdue invoice with computed months and amount', async () => {
    const invoiceId = await overdueInvoice(100); // subtotal 1000; (100-30)/30 → 2 months
    const res = await app.inject({
      method: 'GET',
      url: '/v1/surcharges/suggestions',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.enabled).toBe(true);
    const row = body.suggestions.find((s: any) => s.invoice_id === invoiceId);
    expect(row).toBeDefined();
    expect(row.chargeable_months).toBe(2);
    expect(row.base_outstanding_pkr).toBe(1000);
    expect(row.suggested_amount_pkr).toBe(40); // 1000 × 2% × 2
  });

  it('S2. apply → record + surcharge_total + balanced JE (DR 1120 / CR 4210) + audit row', async () => {
    const invoiceId = await overdueInvoice(100);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const rec = JSON.parse(res.body).data;
    expect(rec.months_charged).toBe(2);
    expect(rec.amount_pkr).toBe(40);
    expect(rec.journal_entry_id).toBeTruthy();

    // invoice carries the surcharge in its outstanding balance
    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    const inv = JSON.parse(invRes.body).data;
    expect(inv.surcharge_total_pkr).toBe(40);
    expect(inv.balance_due_pkr).toBe(1040);

    // JE: DR 1120 (trader AR) / CR 4210
    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: rec.journal_entry_id },
    });
    expect(lines.find((l) => l.accountCode === '1120')?.debitAmount.toString()).toBe('40');
    expect(lines.find((l) => l.accountCode === '4210')?.creditAmount.toString()).toBe('40');
    const entry = await prisma.journalEntry.findUnique({ where: { id: rec.journal_entry_id } });
    expect(entry?.entryType).toBe('SURCHARGE');

    // audit trigger wrote a row for the new surcharge record
    const auditCount = await prisma.auditLog.count({
      where: { tableName: 'invoice_surcharges', recordId: rec.id },
    });
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });

  it('S3. re-apply in the same period → 409 SURCHARGE_ALREADY_APPLIED; +30 days → only the incremental month', async () => {
    const invoiceId = await overdueInvoice(100);
    const first = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(first.statusCode).toBe(201);

    const again = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('SURCHARGE_ALREADY_APPLIED');

    // 30 more days elapse → one more month becomes chargeable
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { invoiceDate: daysAgoDate(130) },
    });
    const incremental = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(incremental.statusCode).toBe(201);
    const rec = JSON.parse(incremental.body).data;
    expect(rec.months_charged).toBe(1);
    expect(rec.amount_pkr).toBe(20); // non-compounding: still 2% of 1000
  });

  it('S4. payment can settle total + surcharge; aging report includes surcharge', async () => {
    const invoiceId = await overdueInvoice(100);
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });

    // aging includes the surcharge before payment
    const aging = await app.inject({
      method: 'GET',
      url: `/v1/reports/receivables-aging?party_id=${ownerPartyId}`,
      headers: authHeaders(accountantToken),
    });
    expect(aging.statusCode).toBe(200);
    const agingBody = JSON.parse(aging.body).data;
    const partyRow = agingBody.parties.find((p: any) => p.party_id === ownerPartyId);
    expect(partyRow).toBeDefined();
    // multiple invoices may exist for this party — at minimum this one's 1040
    expect(partyRow.total_due_pkr).toBeGreaterThanOrEqual(1040);

    // full settlement of 1040 is accepted (old logic would cap at 1000)
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: new Date().toISOString().slice(0, 10),
        amount_pkr: 1040,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: 1040 }],
      },
    });
    expect(payRes.statusCode).toBe(201);

    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(managerToken),
    });
    expect(JSON.parse(invRes.body).data.balance_due_pkr).toBe(0);
  });

  it('S5. GET /v1/invoices/:id/surcharges lists applied records', async () => {
    const invoiceId = await overdueInvoice(100);
    await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: { notes: 'phone agreed with arhti' },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const list = JSON.parse(res.body).data;
    expect(list.length).toBe(1);
    expect(list[0].notes).toBe('phone agreed with arhti');
  });

  it('S6. RBAC: OPERATOR cannot apply (403); not-overdue invoice → 422', async () => {
    const invoiceId = await overdueInvoice(100);
    const opRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(operatorToken),
      payload: {},
    });
    expect(opRes.statusCode).toBe(403);

    const freshId = await overdueInvoice(5); // within grace
    const freshRes = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${freshId}/surcharges`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(freshRes.statusCode).toBe(422);
    expect(JSON.parse(freshRes.body).error.code).toBe('SURCHARGE_NOT_ELIGIBLE');
  });

  it('S7. disabled rule → empty suggestions and apply rejected', async () => {
    const invoiceId = await overdueInvoice(100);
    await setSurchargeRule({ enabled: false, pct_per_month: 2, grace_days: 30 });
    try {
      const sugRes = await app.inject({
        method: 'GET',
        url: '/v1/surcharges/suggestions',
        headers: authHeaders(accountantToken),
      });
      const body = JSON.parse(sugRes.body).data;
      expect(body.enabled).toBe(false);
      expect(body.suggestions).toEqual([]);

      const applyRes = await app.inject({
        method: 'POST',
        url: `/v1/invoices/${invoiceId}/surcharges`,
        headers: authHeaders(accountantToken),
        payload: {},
      });
      expect(applyRes.statusCode).toBe(422);
      expect(JSON.parse(applyRes.body).error.code).toBe('SURCHARGE_RULE_DISABLED');
    } finally {
      await setSurchargeRule({ enabled: true, pct_per_month: 2, grace_days: 30 });
    }
  });
});
