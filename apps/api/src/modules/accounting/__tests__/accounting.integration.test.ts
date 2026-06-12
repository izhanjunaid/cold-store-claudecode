import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000300';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000550';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let operatorToken: string;
let testParty: string;

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

async function createInvoiceAndFinalize(): Promise<{ invoiceId: string; invoiceNumber: string; totalPkr: number }> {
  const lotRes = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: testParty,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: 20,
      accepted_weight_kg: 400,
      inbound_date: '2026-04-01',
    },
  });
  expect(lotRes.statusCode).toBe(201);
  const lotId = JSON.parse(lotRes.body).data.id;

  const outRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: 20,
      outbound_date: '2026-04-30',
    },
  });
  expect(outRes.statusCode).toBe(201);
  const outboundId = JSON.parse(outRes.body).data.id;

  const wRes = await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 400 },
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
  expect(draftInvoiceId).toBeTruthy();

  const finalRes = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${draftInvoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finalRes.statusCode).toBe(200);
  const finalized = JSON.parse(finalRes.body).data;
  return { invoiceId: finalized.id, invoiceNumber: finalized.invoice_number, totalPkr: finalized.total_pkr };
}

async function cleanup() {
  await prisma.creditNoteLineItem.deleteMany({ where: { creditNote: { facilityId: TEST_FACILITY_ID } } });
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
  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
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
  testParty = await createParty(`AcctTest-${Date.now()}`, `0300${Date.now() % 10000000}`.slice(0, 11));
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

describe('Phase 8 — Chart of Accounts', () => {
  it('lists 83 seeded accounts (73 from 8A + 8 from 8B + 2 from Phase 12)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/accounts',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(83);
  });

  it('filters by account_class', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/accounts?account_class=REVENUE',
      headers: authHeaders(accountantToken),
    });
    const body = JSON.parse(res.body);
    expect(body.data.every((a: { account_class: string }) => a.account_class === 'REVENUE')).toBe(true);
  });

  it('OPERATOR cannot create new accounts', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(operatorToken),
      payload: {
        account_code: '9999',
        account_name: 'Fake',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('OWNER can create a new account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '6199',
        account_name: 'Test Misc',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        normal_balance: 'DEBIT',
      },
    });
    expect([201, 400]).toContain(res.statusCode); // 400 if leftover from prior run
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: '6199' } });
  });
});

describe('Phase 8 — Journal entries (forward path)', () => {
  it('Invoice finalize posts a balanced JE-01', async () => {
    const { invoiceId } = await createInvoiceAndFinalize();
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(inv?.journalEntryId).not.toBeNull();

    const je = await prisma.journalEntry.findUnique({
      where: { id: inv!.journalEntryId! },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('INVOICE');
    expect(je?.postingStatus).toBe('POSTED');
    const totalDebit = je!.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalCredit = je!.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalDebit).toBeCloseTo(totalCredit);
  });

  it('CASH payment posts JE-02 (DR 1010 / CR 1110)', async () => {
    const { invoiceId, totalPkr } = await createInvoiceAndFinalize();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: testParty,
        payment_date: '2026-04-30',
        amount_pkr: totalPkr,
        payment_method: 'CASH',
        is_advance: false,
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr }],
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    const dbPay = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: { journalEntry: { include: { lines: true } } },
    });
    expect(dbPay?.assetAccountCode).toBe('1010');
    expect(dbPay?.journalEntry?.entryType).toBe('PAYMENT');
    const lines = dbPay!.journalEntry!.lines;
    expect(Number(lines.find((l) => l.accountCode === '1010')!.debitAmount)).toBeCloseTo(totalPkr);
    expect(Number(lines.find((l) => l.accountCode === '1110')!.creditAmount)).toBeCloseTo(totalPkr);
  });

  it('CHEQUE dishonour posts JE-06 and marks JE-02 reversed', async () => {
    const { invoiceId, totalPkr } = await createInvoiceAndFinalize();

    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: testParty,
        payment_date: '2026-04-30',
        amount_pkr: totalPkr,
        payment_method: 'CHEQUE',
        reference_number: 'CHQ-1',
        cheque_date: '2026-05-15',
        is_advance: false,
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr }],
      },
    });
    const payment = JSON.parse(payRes.body).data;
    const originalJEId = (await prisma.payment.findUnique({ where: { id: payment.id } }))!.journalEntryId!;

    const dishonourRes = await app.inject({
      method: 'POST',
      url: `/v1/payments/${payment.id}/dishonour`,
      headers: authHeaders(accountantToken),
      payload: { notes: 'Insufficient funds' },
    });
    expect(dishonourRes.statusCode).toBe(200);

    const originalJE = await prisma.journalEntry.findUnique({ where: { id: originalJEId } });
    expect(originalJE?.postingStatus).toBe('REVERSED');
    expect(originalJE?.reversedById).not.toBeNull();

    const reversal = await prisma.journalEntry.findUnique({
      where: { id: originalJE!.reversedById! },
      include: { lines: true },
    });
    expect(reversal?.entryType).toBe('REVERSAL');
    const dr = reversal!.lines.find((l) => l.accountCode === '1110');
    const cr = reversal!.lines.find((l) => l.accountCode === '1020');
    expect(Number(dr!.debitAmount)).toBeCloseTo(totalPkr);
    expect(Number(cr!.creditAmount)).toBeCloseTo(totalPkr);
  });

  it('ADVANCE payment posts JE-03 (DR 1020 / CR 2010)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: testParty,
        payment_date: '2026-04-30',
        amount_pkr: 3000,
        payment_method: 'BANK_TRANSFER',
        is_advance: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    const dbPay = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: { journalEntry: { include: { lines: true } } },
    });
    expect(dbPay?.journalEntry?.entryType).toBe('ADVANCE');
    const lines = dbPay!.journalEntry!.lines;
    expect(Number(lines.find((l) => l.accountCode === '1020')!.debitAmount)).toBe(3000);
    expect(Number(lines.find((l) => l.accountCode === '2010')!.creditAmount)).toBe(3000);
  });
});

describe('Phase 8 — Manual journal entries (S-36)', () => {
  it('rejects unbalanced lines', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'Unbalanced test',
        book_type: 'PACCI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 80 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('JOURNAL_UNBALANCED');
  });

  it('rejects posting to a HEADER account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'Header test',
        book_type: 'PACCI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1000', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('HEADER_ACCOUNT_NOT_POSTABLE');
  });

  it('rejects unknown account codes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'Unknown account',
        book_type: 'PACCI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '9999', debit_amount: 50, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 50 },
        ],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('OPERATOR cannot post manual JE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(operatorToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'attempt',
        book_type: 'PACCI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('only OWNER can post KATCHI entries', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'KATCHI attempt',
        book_type: 'KATCHI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(ownerToken),
      payload: {
        entry_date: '2026-04-30',
        description: 'KATCHI ok',
        book_type: 'KATCHI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 100 },
        ],
      },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe('Phase 8 — Period locks', () => {
  it('OPERATOR cannot lock a period', async () => {
    const failRes = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(operatorToken),
      payload: { period_year: 2026, period_month: 1, reason: 'Year close' },
    });
    expect(failRes.statusCode).toBe(403);
  });

  it('locked period rejects manual JE in that period', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 1, reason: 'Test lock' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-01-15',
        description: 'Backdated to locked period',
        book_type: 'PACCI',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 100, credit_amount: 0 },
          { account_code: '4010', debit_amount: 0, credit_amount: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
  });

  it('OWNER can unlock; ACCOUNTANT cannot', async () => {
    const failRes = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/1/unlock',
      headers: authHeaders(accountantToken),
      payload: { reason: 'reopen for adjustments' },
    });
    expect(failRes.statusCode).toBe(403);

    const okRes = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/1/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'reopen for adjustments' },
    });
    expect(okRes.statusCode).toBe(200);
  });
});

describe('Phase 8 — Trial balance & financial statements', () => {
  it('trial balance is balanced', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/trial-balance?date_to=2026-12-31',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.is_balanced).toBe(true);
    expect(body.total_debit_pkr).toBeCloseTo(body.total_credit_pkr);
  });

  it('balance sheet is balanced (Assets = Liab + Equity)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/balance-sheet?as_of_date=2026-12-31',
      headers: authHeaders(accountantToken),
    });
    const body = JSON.parse(res.body).data;
    expect(body.is_balanced).toBe(true);
    expect(body.total_assets_pkr).toBeCloseTo(body.total_liabilities_and_equity_pkr);
  });

  it('P&L returns revenue and net profit fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/profit-loss?date_from=2026-01-01&date_to=2026-12-31',
      headers: authHeaders(accountantToken),
    });
    const body = JSON.parse(res.body).data;
    expect(body).toHaveProperty('total_revenue_pkr');
    expect(body).toHaveProperty('gross_profit_pkr');
    expect(body).toHaveProperty('net_profit_pkr');
  });
});

describe('Phase 8 — Bad debt write-off', () => {
  it('OWNER writes off invoice → JE-08 posted, status WRITTEN_OFF', async () => {
    const { invoiceId } = await createInvoiceAndFinalize();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Defaulted', write_off_date: '2026-04-30' },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.status).toBe('WRITTEN_OFF');
    expect(data.journal_entry_id).toBeTruthy();
  });

  it('ACCOUNTANT cannot write off (OWNER-only)', async () => {
    const { invoiceId } = await createInvoiceAndFinalize();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${invoiceId}/write-off`,
      headers: authHeaders(accountantToken),
      payload: { reason: 'try', write_off_date: '2026-04-30' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Phase 8 — Credit notes (JE-05)', () => {
  it('issuing a credit note posts JE-05 and reduces invoice balance', async () => {
    const { invoiceId } = await createInvoiceAndFinalize();
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(managerToken),
      payload: {
        original_invoice_id: invoiceId,
        credit_date: '2026-04-30',
        reason: 'Loading fee disputed',
        line_items: [
          { revenue_account_code: '4010', description: 'Storage adjust', amount_pkr: 500 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const cn = JSON.parse(res.body).data;
    expect(cn.journal_entry_id).toBeTruthy();
    expect(cn.status).toBe('APPLIED');

    const after = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    expect(Number(after!.amountPaidPkr) - Number(inv!.amountPaidPkr)).toBeCloseTo(500);
  });

  it('OPERATOR cannot issue a credit note', async () => {
    const { invoiceId } = await createInvoiceAndFinalize();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(operatorToken),
      payload: {
        original_invoice_id: invoiceId,
        credit_date: '2026-04-30',
        reason: 'Try',
        line_items: [{ revenue_account_code: '4010', description: 'attempt', amount_pkr: 100 }],
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Phase 8 — General ledger', () => {
  it('GL by account returns balanced lines with running balance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/general-ledger?account_code=1110',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.account_code).toBe('1110');
    expect(Array.isArray(body.entries)).toBe(true);
    const expectedClosing = body.opening_balance_pkr + body.total_debit_pkr - body.total_credit_pkr;
    expect(body.closing_balance_pkr).toBeCloseTo(expectedClosing);
  });
});
