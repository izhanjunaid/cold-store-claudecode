import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../../pdf/pdf.service', async () => {
  const actual = await vi.importActual<typeof import('../../pdf/pdf.service')>(
    '../../pdf/pdf.service',
  );
  return {
    ...actual,
    renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF mock\n')),
    renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF ack\n')),
    renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF dn\n')),
    renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF inv\n')),
    renderPartyStatement: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 stmt mock\n')),
  };
});

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const APPLE_ID = '00000000-0000-0000-0000-000000000101';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN_MONTHLY = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let operatorToken: string;
let partyA: string;
let partyB: string;
let lotPotato: string;
let lotApple: string;
let invoiceA: string;
let invoiceAge100Total: number;

async function createParty(name: string, phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name, party_type: 'FARMER', phone_primary: phone, credit_terms_days: 30 },
  });
  if (res.statusCode !== 201) throw new Error(`createParty: ${res.body}`);
  return JSON.parse(res.body).data.id as string;
}

async function createLot(opts: {
  ownerPartyId: string;
  commodityId: string;
  inboundDate: string;
  quantityBags: number;
  acceptedWeightKg: number;
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: opts.ownerPartyId,
      commodity_id: opts.commodityId,
      rate_plan_id: RATE_PLAN_MONTHLY,
      chamber_id: CHAMBER_A,
      quantity_bags: opts.quantityBags,
      accepted_weight_kg: opts.acceptedWeightKg,
      inbound_date: opts.inboundDate,
    },
  });
  if (res.statusCode !== 201) throw new Error(`createLot: ${res.body}`);
  return JSON.parse(res.body).data.id as string;
}

async function fullWithdrawAndFinalize(
  lotId: string,
  outboundDate: string,
  weightKg: number,
  bags: number,
): Promise<{ invoiceId: string; invoiceNumber: string; totalPkr: number }> {
  const outRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: bags,
      outbound_date: outboundDate,
    },
  });
  expect(outRes.statusCode).toBe(201);
  const outboundId = JSON.parse(outRes.body).data.id;

  const wRes = await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: weightKg },
  });
  expect(wRes.statusCode).toBe(200);

  const finOutRes = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finOutRes.statusCode).toBe(200);
  const draftInvoiceId = JSON.parse(finOutRes.body).data.invoice_id as string;

  const finalRes = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${draftInvoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finalRes.statusCode).toBe(200);
  const finalized = JSON.parse(finalRes.body).data;
  return {
    invoiceId: finalized.id,
    invoiceNumber: finalized.invoice_number,
    totalPkr: finalized.total_pkr,
  };
}

async function cleanup() {
  await withGuardsDisabled(prisma, cleanupInner);
}

async function cleanupInner() {
  await prisma.creditNoteLineItem.deleteMany({
    where: { creditNote: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.creditNote.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntry.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { reversedById: null },
  });
  await prisma.invoice.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { journalEntryId: null },
  });
  await prisma.payment.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { journalEntryId: null },
  });
  await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.paymentAllocation.deleteMany({
    where: { payment: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoice: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({
    where: { lot: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();

  const owner = await loginAsRole(app, 'OWNER');
  const manager = await loginAsRole(app, 'MANAGER');
  const accountant = await loginAsRole(app, 'ACCOUNTANT');
  const operator = await loginAsRole(app, 'OPERATOR');
  ownerToken = owner.accessToken;
  managerToken = manager.accessToken;
  accountantToken = accountant.accessToken;
  operatorToken = operator.accessToken;

  partyA = await createParty(`ReportA-${Date.now()}`, `0301${Date.now() % 1000000}`.slice(0, 11));
  partyB = await createParty(`ReportB-${Date.now()}`, `0302${Date.now() % 1000000}`.slice(0, 11));

  // Two ACTIVE lots, different commodities
  lotPotato = await createLot({
    ownerPartyId: partyA,
    commodityId: POTATO_ID,
    inboundDate: '2026-01-10',
    quantityBags: 40,
    acceptedWeightKg: 800,
  });
  lotApple = await createLot({
    ownerPartyId: partyB,
    commodityId: APPLE_ID,
    inboundDate: '2025-12-01',
    quantityBags: 25,
    acceptedWeightKg: 500,
  });

  // A third lot that gets fully withdrawn → finalized invoice for partyA (aged ~100 days)
  const lotForInvoice = await createLot({
    ownerPartyId: partyA,
    commodityId: POTATO_ID,
    inboundDate: '2026-01-01',
    quantityBags: 20,
    acceptedWeightKg: 400,
  });
  const inv = await fullWithdrawAndFinalize(lotForInvoice, '2026-02-10', 395, 20);
  invoiceA = inv.invoiceId;
  invoiceAge100Total = Number(inv.totalPkr);

  // Force invoice_date back ~100 days from today so it falls into b_90_plus bucket
  const ageDate = new Date(Date.now() - 100 * 86_400_000);
  await prisma.invoice.update({
    where: { id: invoiceA },
    data: { invoiceDate: ageDate },
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

// ============================================================
// Dashboard
// ============================================================
describe('GET /v1/reports/dashboard', () => {
  it('MANAGER receives full payload including financial block', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/dashboard',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.active_lots).toBeGreaterThanOrEqual(2);
    expect(body.data.chambers.length).toBeGreaterThan(0);
    expect(body.data.financial).not.toBeNull();
    expect(body.data.financial.ar_total_pkr).toBeGreaterThan(0);
  });

  it('OPERATOR receives operational fields with financial=null', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/dashboard',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.active_lots).toBeGreaterThanOrEqual(2);
    expect(body.data.financial).toBeNull();
  });

  it('occupancy_pct is computed from active lots and chamber capacity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/dashboard',
      headers: authHeaders(managerToken),
    });
    const body = JSON.parse(res.body);
    expect(typeof body.data.occupancy_pct).toBe('number');
    expect(body.data.occupancy_pct).toBeGreaterThanOrEqual(0);
    expect(body.data.occupancy_pct).toBeLessThanOrEqual(100);
  });

  it('unbilled_invoices surfaces a DISPATCHED outbound whose invoice is still DRAFT, and a transfer-accrued DRAFT invoice, but not the already-finalized one', async () => {
    // Dispatch-linked: withdraw + finalize the outbound, but leave the invoice DRAFT.
    const lotForDispatch = await createLot({
      ownerPartyId: partyA,
      commodityId: POTATO_ID,
      inboundDate: '2026-03-01',
      quantityBags: 15,
      acceptedWeightKg: 300,
    });
    const outRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lotForDispatch,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: 15,
        outbound_date: '2026-03-15',
      },
    });
    expect(outRes.statusCode).toBe(201);
    const outboundId = JSON.parse(outRes.body).data.id;
    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${outboundId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 295 },
    });
    const finOutRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${outboundId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(finOutRes.statusCode).toBe(200);
    const dispatchInvoiceId = JSON.parse(finOutRes.body).data.invoice_id as string;

    // Transfer-accrued: FULL transfer generates a standalone DRAFT invoice
    // for the outgoing owner with no outbound event.
    const lotForTransfer = await createLot({
      ownerPartyId: partyA,
      commodityId: POTATO_ID,
      inboundDate: '2026-03-01',
      quantityBags: 8,
      acceptedWeightKg: 160,
    });
    const transferRes = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotForTransfer}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'FULL',
        to_party_id: partyB,
        effective_date: '2026-03-20',
      },
    });
    expect(transferRes.statusCode).toBe(201);
    const transferInvoiceId = JSON.parse(transferRes.body).data.accrued_invoice_id as string;

    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/dashboard',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.unbilled_invoices).not.toBeNull();
    const ids = body.data.unbilled_invoices.items.map((i: { invoice_id: string }) => i.invoice_id);
    expect(ids).toContain(dispatchInvoiceId);
    expect(ids).toContain(transferInvoiceId);
    expect(ids).not.toContain(invoiceA); // already finalized in beforeAll
    expect(body.data.unbilled_invoices.count).toBeGreaterThanOrEqual(2);
    expect(body.data.unbilled_invoices.total_pkr).toBeGreaterThan(0);
    const dispatchRow = body.data.unbilled_invoices.items.find(
      (i: { invoice_id: string }) => i.invoice_id === dispatchInvoiceId,
    );
    const transferRow = body.data.unbilled_invoices.items.find(
      (i: { invoice_id: string }) => i.invoice_id === transferInvoiceId,
    );
    expect(dispatchRow.source).toBe('DISPATCH');
    expect(transferRow.source).toBe('TRANSFER');
  });

  it('unbilled_invoices is null for OPERATOR (financial-gated like the rest of the block)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/dashboard',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.unbilled_invoices).toBeNull();
  });
});

// ============================================================
// Lot Aging
// ============================================================
describe('GET /v1/reports/lot-aging', () => {
  it('MANAGER sees active lots with days_in_storage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/lot-aging',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    for (const r of body.data) {
      expect(r.days_in_storage).toBeGreaterThanOrEqual(0);
      expect(r.threshold).toBeGreaterThan(0);
    }
  });

  it('filters by commodity_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/lot-aging?commodity_id=${POTATO_ID}`,
      headers: authHeaders(managerToken),
    });
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    for (const r of body.data) expect(r.commodity_name).toBe('POTATO');
  });

  it('OPERATOR is denied (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/lot-aging',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ============================================================
// Receivables Aging
// ============================================================
describe('GET /v1/reports/receivables-aging', () => {
  it('ACCOUNTANT sees aged invoice in 90+ bucket', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/receivables-aging',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.buckets.b_90_plus).toBeGreaterThan(0);
    expect(body.data.buckets.total_pkr).toBeCloseTo(invoiceAge100Total, 1);
    expect(body.data.parties.length).toBeGreaterThanOrEqual(1);
    const partyARow = body.data.parties.find((p: { party_id: string }) => p.party_id === partyA);
    expect(partyARow).toBeTruthy();
    expect(partyARow.oldest_invoice_days).toBeGreaterThanOrEqual(90);
  });

  it('OPERATOR is denied (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/receivables-aging',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('AR reconciliation: facility total matches GL accounts 1110+1120+1130+1150', async () => {
    const arRes = await app.inject({
      method: 'GET',
      url: '/v1/reports/receivables-aging',
      headers: authHeaders(accountantToken),
    });
    const ar = JSON.parse(arRes.body).data;

    const today = new Date().toISOString().slice(0, 10);
    const codes = ['1110', '1120', '1130', '1150'];
    let glSum = 0;
    for (const code of codes) {
      const r = await app.inject({
        method: 'GET',
        url: `/v1/accounting/general-ledger?account_code=${code}&date_to=${today}`,
        headers: authHeaders(accountantToken),
      });
      if (r.statusCode === 200) {
        const body = JSON.parse(r.body);
        glSum += Number(body.data.closing_balance_pkr ?? 0);
      }
    }
    expect(Math.abs(ar.buckets.total_pkr - glSum)).toBeLessThan(0.5);
    // The report now carries its own GL control total + variance (phase/19).
    expect(ar.reconciled).toBe(true);
    expect(Math.abs(ar.gl_ar_control_total_pkr - ar.net_total_pkr)).toBeLessThan(0.01);
    expect(Math.abs(ar.gl_ar_control_total_pkr - glSum)).toBeLessThan(0.5);
  });

  it('on-account credit reduces net due (not the gross buckets) and stays GL-reconciled (phase/19)', async () => {
    const party = await createParty(`AR-OnAccount-${Date.now()}`, `0302${Date.now() % 1000000}`.slice(0, 11));
    const lotId = await createLot({
      ownerPartyId: party,
      commodityId: POTATO_ID,
      inboundDate: '2026-03-01',
      quantityBags: 30,
      acceptedWeightKg: 600,
    });
    const inv = await fullWithdrawAndFinalize(lotId, '2026-03-28', 600, 30);
    const onAccount = Math.round(inv.totalPkr * 0.3);

    const pay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: party,
        payment_date: '2026-04-01',
        amount_pkr: onAccount,
        payment_method: 'CASH',
        allocations: [],
      },
    });
    expect(pay.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/receivables-aging?party_id=${party}`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const ar = JSON.parse(res.body).data;
    const row = ar.parties.find((p: { party_id: string }) => p.party_id === party);
    expect(row).toBeTruthy();
    // Gross bucket total is the full invoice; the unapplied credit shows as a
    // separate reduction, and net = gross − credit.
    expect(row.total_due_pkr).toBeCloseTo(inv.totalPkr, 1);
    expect(row.unapplied_credit_pkr).toBeCloseTo(onAccount, 1);
    expect(row.net_due_pkr).toBeCloseTo(inv.totalPkr - onAccount, 1);
    expect(ar.net_total_pkr).toBeCloseTo(inv.totalPkr - onAccount, 1);
    // GL AR control for this party (JE-01 debit − JE-02 credit) equals net.
    expect(ar.gl_ar_control_total_pkr).toBeCloseTo(inv.totalPkr - onAccount, 1);
    expect(ar.reconciled).toBe(true);
  });
});

// ============================================================
// Commodity Inventory
// ============================================================
describe('GET /v1/reports/commodity-inventory', () => {
  it('groups active lots by commodity and chamber', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/commodity-inventory',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
    const potato = body.data.find((c: { commodity_name: string }) => c.commodity_name === 'POTATO');
    expect(potato).toBeTruthy();
    expect(potato.total_bags).toBeGreaterThan(0);
    expect(potato.per_chamber.length).toBeGreaterThan(0);
  });
});

// ============================================================
// Weight Variance
// ============================================================
describe('GET /v1/reports/weight-variance', () => {
  it('shows variance row for fully-withdrawn lot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/weight-variance',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const row = body.data[0];
    expect(row.outbound_kg_total).toBeGreaterThan(0);
    expect(row.inbound_kg_prorated).toBeGreaterThan(0);
    expect(typeof row.variance_pct).toBe('number');
  });

  it('excludes lots without DISPATCHED outbound', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/weight-variance',
      headers: authHeaders(managerToken),
    });
    const body = JSON.parse(res.body);
    expect(body.data.every((r: { finalized_outbound_count: number }) => r.finalized_outbound_count > 0)).toBe(true);
  });
});

// ============================================================
// Cash Exceptions (phase/24) — replaces the reverted P1-6 posting-time guard
// ============================================================
describe('GET /v1/reports/cash-exceptions', () => {
  it('lists every cash-class account (1000\'s children) with a balance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/cash-exceptions',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const codes = body.rows.map((r: { account_code: string }) => r.account_code);
    expect(codes).toEqual(expect.arrayContaining(['1010', '1020', '1030']));
  });

  it('OPERATOR is denied — reports.financial is ACCOUNTANT+', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/cash-exceptions',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('flags a negative cash balance without ever rejecting the posting that caused it', async () => {
    // This is the behavioural point of the whole report: P1-6's reverted
    // guard would have 422'd this post outright. Nothing here blocks it —
    // the report surfaces the exception after the fact instead.
    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-03-01',
        description: 'cash-exceptions test — drive 1030 negative',
        posting_status: 'POSTED',
        lines: [
          { account_code: '6100', debit_amount: 500, credit_amount: 0 },
          { account_code: '1030', debit_amount: 0, credit_amount: 500 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/cash-exceptions?as_of_date=2026-03-01',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    const wallet = body.rows.find((r: { account_code: string }) => r.account_code === '1030');
    expect(wallet.balance_pkr).toBeLessThan(0);
    expect(wallet.is_negative).toBe(true);
    expect(body.has_exceptions).toBe(true);
  });
});

// ============================================================
// Seasonal Summary
// ============================================================
describe('GET /v1/reports/seasonal-summary', () => {
  it('OWNER sees totals for the season window', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/seasonal-summary?date_from=2025-12-01&date_to=2026-12-31',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.total_inbound_bags).toBeGreaterThan(0);
    expect(body.data.total_outbound_bags).toBeGreaterThanOrEqual(0);
    expect(body.data.total_revenue_pkr).toBeGreaterThanOrEqual(0);
    expect(body.data.commodities.length).toBeGreaterThan(0);
  });

  it('rejects missing date_from with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/seasonal-summary?date_to=2026-05-01',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(400);
  });

  it('MANAGER is denied (403, OWNER-only)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/seasonal-summary?date_from=2026-01-01&date_to=2026-12-31',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ============================================================
// Party Statement
// ============================================================
describe('GET /v1/reports/party-statement/:partyId', () => {
  it('returns JSON ledger with opening balance and CR/DR/CN aware fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.party_id).toBe(partyA);
    expect(typeof body.data.opening_balance_pkr).toBe('number');
    expect(body.data.entries.some((e: { type: string }) => e.type === 'INVOICE')).toBe(true);
  });

  it('opening_balance reflects pre-period entries when date_from is set', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?date_from=${future}`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.opening_balance_pkr).toBeGreaterThan(0);
    expect(body.data.entries.length).toBe(0);
  });

  it('PACCI vs KATCHI filter narrows the entry set; KATCHI view is MANAGER-gated (F-9)', async () => {
    const pacciRes = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?book_type=PACCI`,
      headers: authHeaders(accountantToken),
    });
    expect(pacciRes.statusCode).toBe(200);
    const pacci = JSON.parse(pacciRes.body).data;
    expect(pacci.entries.length).toBeGreaterThan(0);

    // The informal book is not visible below MANAGER.
    const katchiAsAccountant = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?book_type=KATCHI`,
      headers: authHeaders(accountantToken),
    });
    expect(katchiAsAccountant.statusCode).toBe(403);

    const katchiAsManager = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?book_type=KATCHI`,
      headers: authHeaders(managerToken),
    });
    expect(katchiAsManager.statusCode).toBe(200);
    expect(JSON.parse(katchiAsManager.body).data.entries.length).toBe(0); // no KATCHI fixtures
  });

  it('format=pdf returns application/pdf with a buffer body', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?format=pdf`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.length).toBeGreaterThan(0);
  });

  it('OPERATOR is denied (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/reports/ownership-transfers', () => {
  let transferLotId: string;
  let transferChildLotId: string | null = null;

  beforeAll(async () => {
    // Create a fresh active lot owned by partyA and partially transfer some bags to partyB.
    transferLotId = await createLot({
      ownerPartyId: partyA,
      commodityId: POTATO_ID,
      inboundDate: '2026-02-01',
      quantityBags: 30,
      acceptedWeightKg: 600,
    });

    const transferRes = await app.inject({
      method: 'POST',
      url: `/v1/lots/${transferLotId}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: partyB,
        quantity_bags: 10,
        transfer_price_pkr: 500,
        effective_date: '2026-02-05',
      },
    });
    expect(transferRes.statusCode).toBe(201);
    transferChildLotId = JSON.parse(transferRes.body).data.child_lot_id ?? null;
  });

  it('returns paginated transfer rows with from/to party names', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/ownership-transfers',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1 });
    const ours = body.data.find((r: any) => r.lot_id === transferLotId);
    expect(ours).toBeDefined();
    expect(ours.from_party_name).toBeTruthy();
    expect(ours.to_party_name).toBeTruthy();
    expect(ours.quantity_bags).toBe(10);
    expect(ours.transfer_price_pkr).toBe(500);
    expect(ours.type).toBe('PARTIAL');
    if (transferChildLotId) {
      expect(ours.child_lot_id).toBe(transferChildLotId);
    }
  });

  it('filters by party_id (matches from or to side)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/ownership-transfers?party_id=${partyB}`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.every((r: any) => r.from_party_id === partyB || r.to_party_id === partyB)).toBe(
      true,
    );
  });

  it('OPERATOR is denied (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/ownership-transfers',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
