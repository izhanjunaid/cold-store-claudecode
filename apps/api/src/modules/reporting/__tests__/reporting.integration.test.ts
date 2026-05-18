import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

  it('PACCI vs KATCHI filter narrows the entry set', async () => {
    const pacciRes = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?book_type=PACCI`,
      headers: authHeaders(accountantToken),
    });
    const katchiRes = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${partyA}?book_type=KATCHI`,
      headers: authHeaders(accountantToken),
    });
    expect(pacciRes.statusCode).toBe(200);
    expect(katchiRes.statusCode).toBe(200);
    const pacci = JSON.parse(pacciRes.body).data;
    const katchi = JSON.parse(katchiRes.body).data;
    expect(pacci.entries.length).toBeGreaterThan(0);
    expect(katchi.entries.length).toBe(0); // no KATCHI fixtures
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
