/**
 * Late-payment surcharge (phase/19) — migration-free, GL-based:
 *   one JE-21 per chargeable month (DR party AR / CR 4210), idempotent per
 *   30-day block, surfaced in AR aging + the party statement, GL-reconciled.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html></html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html></html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html></html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html></html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000300';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000550';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let operatorToken: string;
let partyId: string;

async function setRule(enabled: boolean) {
  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/facilities/me',
    headers: authHeaders(ownerToken),
    payload: { settings: { late_payment_surcharge: { enabled, pct_per_month: 2, grace_days: 30 } } },
  });
  expect(res.statusCode).toBe(200);
}

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    // Allocations first: deleting an invoice nulls payment_allocations.invoice_id,
    // which violates the target-XOR check constraint.
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

async function finalizedInvoice(
  inbound = '2026-03-01',
  outbound = '2026-03-28',
  invoiceDate = '2026-03-28',
): Promise<{ invoiceId: string; total: number }> {
  const lotRes = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: 20,
      accepted_weight_kg: 400,
      inbound_date: inbound,
    },
  });
  expect(lotRes.statusCode).toBe(201);
  const lotId = JSON.parse(lotRes.body).data.id;

  const outRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 20, outbound_date: outbound },
  });
  expect(outRes.statusCode).toBe(201);
  const outboundId = JSON.parse(outRes.body).data.id;
  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 400 },
  });
  const fin = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  const draftId = JSON.parse(fin.body).data.invoice_id;
  const finalRes = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${draftId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finalRes.statusCode).toBe(200);
  const inv = JSON.parse(finalRes.body).data;
  // Invoices are dated on finalize (today); backdate so the fixed as_of dates
  // exercise real overdue ages. The JE-01 must move with it, otherwise the GL
  // side of the aging tie-out sits outside the as_of window while the
  // invoice side is inside it. Posted entries are immutable → guards off.
  const backdated = new Date(invoiceDate);
  await withGuardsDisabled(prisma, async () => {
    await prisma.invoice.update({ where: { id: inv.id }, data: { invoiceDate: backdated } });
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, select: { journalEntryId: true } });
    if (row.journalEntryId) {
      await prisma.journalEntry.update({
        where: { id: row.journalEntryId },
        data: {
          entryDate: backdated,
          periodMonth: backdated.getUTCMonth() + 1,
          periodYear: backdated.getUTCFullYear(),
        },
      });
    }
  });
  return { invoiceId: inv.id, total: Number(inv.total_pkr) };
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: `Surcharge-${Date.now()}`, party_type: 'FARMER', phone_primary: `0303${Date.now() % 10000000}`.slice(0, 11), credit_terms_days: 30 },
  });
  expect(partyRes.statusCode).toBe(201);
  partyId = JSON.parse(partyRes.body).data.id;
  await setRule(true);
}, 40_000);

afterAll(async () => {
  await setRule(false);
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

describe('late-payment surcharge', () => {
  it('applies one JE per chargeable month, is idempotent, and reconciles in aging', async () => {
    const { invoiceId, total } = await finalizedInvoice();

    // Invoice dated 2026-03-28; as_of 2026-07-01 → ~95 days overdue, grace 30 → 2 months.
    const apply = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
      payload: { as_of_date: '2026-07-01' },
    });
    expect(apply.statusCode).toBe(201);
    const applied = JSON.parse(apply.body).data;
    expect(applied.months_charged).toBe(2);
    expect(applied.surcharges).toHaveLength(2);
    const perMonth = Math.round(total * 0.02 * 100) / 100;
    expect(applied.amount_pkr).toBeCloseTo(perMonth * 2, 1);

    // Two POSTED JE-21 entries keyed to the invoice, each crediting 4210.
    const jes = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'invoice_surcharge', sourceId: invoiceId, postingStatus: 'POSTED' },
      include: { lines: true },
    });
    expect(jes).toHaveLength(2);
    for (const je of jes) {
      expect(je.entryType).toBe('ACCRUAL');
      expect(je.lines.find((l) => l.accountCode === '4210')).toBeTruthy();
      expect(je.lines.find((l) => l.accountCode === '1110')?.debitAmount.toString()).toBe(String(perMonth));
    }

    // Listing endpoint reflects the posted surcharges.
    const list = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
    });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).data.surcharges).toHaveLength(2);

    // Re-apply inside the same block → nothing chargeable.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
      payload: { as_of_date: '2026-07-01' },
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('SURCHARGE_ALREADY_APPLIED');

    // Aging (as of the surcharge date) includes the surcharge and reconciles to GL.
    const aging = await app.inject({
      method: 'GET',
      url: `/v1/reports/receivables-aging?party_id=${partyId}&as_of_date=2026-07-01`,
      headers: authHeaders(ownerToken),
    });
    expect(aging.statusCode).toBe(200);
    const ar = JSON.parse(aging.body).data;
    expect(ar.buckets.total_pkr).toBeCloseTo(total + perMonth * 2, 1);
    expect(ar.reconciled).toBe(true);

    // Party statement shows the surcharge entries.
    const stmt = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyId}`,
      headers: authHeaders(ownerToken),
    });
    expect(stmt.statusCode).toBe(200);
    const entries = JSON.parse(stmt.body).data.entries as { type: string }[];
    expect(entries.filter((e) => e.type === 'SURCHARGE')).toHaveLength(2);

    // A further block later charges one more month.
    const later = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
      payload: { as_of_date: '2026-08-01' },
    });
    expect(later.statusCode).toBe(201);
    expect(JSON.parse(later.body).data.months_charged).toBe(1);
  });

  it('rejects a surcharge when the rule is disabled', async () => {
    await setRule(false);
    const { invoiceId } = await finalizedInvoice('2026-03-02', '2026-03-29');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
      payload: { as_of_date: '2026-07-01' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('SURCHARGE_RULE_DISABLED');
    await setRule(true);
  });

  it('rejects a surcharge on a fully-paid invoice', async () => {
    const { invoiceId, total } = await finalizedInvoice('2026-03-03', '2026-03-30');
    const pay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(managerToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-04-01',
        amount_pkr: total,
        payment_method: 'CASH',
        allocations: [{ target: 'INVOICE', invoice_id: invoiceId, allocated_amount_pkr: total }],
      },
    });
    expect(pay.statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(managerToken),
      payload: { as_of_date: '2026-07-01' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('SURCHARGE_NOT_ELIGIBLE');
  });

  it('OPERATOR cannot apply a surcharge', async () => {
    const { invoiceId } = await finalizedInvoice('2026-03-04', '2026-03-31');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/surcharges`,
      headers: authHeaders(operatorToken),
      payload: { as_of_date: '2026-07-01' },
    });
    expect(res.statusCode).toBe(403);
  });
});
