import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let operatorToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, cleanupInner);
}

async function cleanupInner() {
  await prisma.expenseVoucher.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { accrualJournalEntryId: null, paymentJournalEntryId: null },
  });
  await prisma.expenseVoucher.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, journalEntry: { sourceTable: 'expense_vouchers' } },
  });
  await prisma.journalEntry.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: 'expense_vouchers' },
  });
  await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

async function createDraft(overrides: any = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/expense-vouchers',
    headers: authHeaders(accountantToken),
    payload: {
      voucher_date: '2026-04-15',
      expense_account_code: '5010',
      description: 'LESCO refrigeration bill',
      vendor_name: 'LESCO',
      amount_pkr: 185000,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

describe('Phase 8B — Expense Vouchers', () => {
  it('creates a DRAFT voucher with EXP-YYYYMM-NNNN number', async () => {
    const v = await createDraft();
    expect(v.status).toBe('DRAFT');
    expect(v.voucher_number).toMatch(/^EXP-202604-\d{4}$/);
    expect(v.amount_pkr).toBe(185000);
  });

  it('OPERATOR cannot create vouchers (ACCOUNTANT+)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/expense-vouchers',
      headers: authHeaders(operatorToken),
      payload: {
        voucher_date: '2026-04-15',
        expense_account_code: '5010',
        description: 'Forbidden',
        amount_pkr: 100,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DRAFT → APPROVED → PAID posts JE-17A', async () => {
    await cleanup();
    const v = await createDraft();
    const approve = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/approve`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    expect(JSON.parse(approve.body).data.status).toBe('APPROVED');

    const pay = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/pay`,
      headers: authHeaders(accountantToken),
      payload: {
        payment_date: '2026-04-20',
        payment_method: 'BANK_TRANSFER',
        asset_account_code: '1020',
      },
    });
    expect(pay.statusCode).toBe(201);
    const paid = JSON.parse(pay.body).data;
    expect(paid.status).toBe('PAID');
    expect(paid.payment_journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: paid.payment_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('EXPENSE');
    expect(je?.lines.find((l) => l.accountCode === '5010')?.debitAmount.toString()).toBe('185000');
    expect(je?.lines.find((l) => l.accountCode === '1020')?.creditAmount.toString()).toBe('185000');
  });

  it('DRAFT → APPROVED → ACCRUED → PAID posts JE-17B then JE-17B-PAY', async () => {
    await cleanup();
    const v = await createDraft();
    await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/approve`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const accrue = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/accrue`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(accrue.statusCode).toBe(201);
    const accrued = JSON.parse(accrue.body).data;
    expect(accrued.status).toBe('ACCRUED');
    expect(accrued.accrual_journal_entry_id).toBeTruthy();

    const accrualJe = await prisma.journalEntry.findUnique({
      where: { id: accrued.accrual_journal_entry_id },
      include: { lines: true },
    });
    // JE-17B: DR 5010, CR 2040
    expect(accrualJe?.lines.find((l) => l.accountCode === '5010')?.debitAmount.toString()).toBe('185000');
    expect(accrualJe?.lines.find((l) => l.accountCode === '2040')?.creditAmount.toString()).toBe('185000');

    const pay = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/pay`,
      headers: authHeaders(accountantToken),
      payload: {
        payment_date: '2026-05-05',
        payment_method: 'BANK_TRANSFER',
        asset_account_code: '1020',
      },
    });
    expect(pay.statusCode).toBe(201);
    const paid = JSON.parse(pay.body).data;
    const payJe = await prisma.journalEntry.findUnique({
      where: { id: paid.payment_journal_entry_id },
      include: { lines: true },
    });
    // JE-17B-PAY: DR 2040, CR 1020 — no expense line
    expect(payJe?.lines.find((l) => l.accountCode === '2040')?.debitAmount.toString()).toBe('185000');
    expect(payJe?.lines.find((l) => l.accountCode === '1020')?.creditAmount.toString()).toBe('185000');
    expect(payJe?.lines.find((l) => l.accountCode === '5010')).toBeUndefined();
  });

  it('cannot pay without approval (DRAFT → pay rejected)', async () => {
    await cleanup();
    const v = await createDraft();
    const pay = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/pay`,
      headers: authHeaders(accountantToken),
      payload: {
        payment_date: '2026-04-20',
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(pay.statusCode).toBe(409);
    expect(JSON.parse(pay.body).error.code).toBe('EXPENSE_VOUCHER_INVALID_STATUS');
  });

  it('cannot edit non-DRAFT voucher', async () => {
    await cleanup();
    const v = await createDraft();
    await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/approve`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    const upd = await app.inject({
      method: 'PATCH',
      url: `/v1/expense-vouchers/${v.id}`,
      headers: authHeaders(accountantToken),
      payload: { amount_pkr: 999 },
    });
    expect(upd.statusCode).toBe(409);
  });

  it('cancel a DRAFT voucher', async () => {
    await cleanup();
    const v = await createDraft();
    const cancel = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/cancel`,
      headers: authHeaders(managerToken),
      payload: { reason: 'duplicate' },
    });
    expect(cancel.statusCode).toBe(200);
    expect(JSON.parse(cancel.body).data.status).toBe('CANCELLED');
  });

  it('petty-cash-replenish posts a single JE: DR 1010 / CR 1020', async () => {
    await cleanup();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/expense-vouchers/petty-cash-replenish',
      headers: authHeaders(accountantToken),
      payload: { replenishment_date: '2026-04-30', amount_pkr: 4500 },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.journal_entry_id).toBeTruthy();
    const je = await prisma.journalEntry.findUnique({
      where: { id: data.journal_entry_id },
      include: { lines: true },
    });
    expect(je?.lines.length).toBe(2);
    expect(je?.lines.find((l) => l.accountCode === '1010')?.debitAmount.toString()).toBe('4500');
    expect(je?.lines.find((l) => l.accountCode === '1020')?.creditAmount.toString()).toBe('4500');
  });

  it('rejects pay when period locked', async () => {
    await cleanup();
    const v = await createDraft({ voucher_date: '2026-06-15' });
    await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/approve`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 6, reason: 'test' },
    });

    const pay = await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/pay`,
      headers: authHeaders(accountantToken),
      payload: {
        payment_date: '2026-06-20',
        payment_method: 'BANK_TRANSFER',
        asset_account_code: '1020',
      },
    });
    expect(pay.statusCode).toBe(409);
    expect(JSON.parse(pay.body).error.code).toBe('PERIOD_LOCKED');

    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/6/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'cleanup' },
    });
  });

  it('OWNER-only KATCHI guard blocks ACCOUNTANT', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/expense-vouchers',
      headers: authHeaders(accountantToken),
      payload: {
        voucher_date: '2026-04-15',
        expense_account_code: '5010',
        description: 'Try katchi as non-owner',
        amount_pkr: 100,
        book_type: 'KATCHI',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  // P1-11 regression. accrue/pay read the voucher with no row lock, so two concurrent
  // calls both passed the status check and both posted — crediting the bank twice for one
  // voucher. Nothing else stopped it: JE-17A stamps the real voucher id but
  // (source_table, source_id) is an @@index, not @@unique.
  it('two concurrent pay() calls post exactly one JE — the loser is rejected', async () => {
    await cleanup();
    const v = await createDraft();
    await app.inject({
      method: 'POST',
      url: `/v1/expense-vouchers/${v.id}/approve`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const payload = {
      payment_date: '2026-05-05',
      payment_method: 'BANK_TRANSFER',
      asset_account_code: '1020',
    };
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/expense-vouchers/${v.id}/pay`,
        headers: authHeaders(accountantToken),
        payload,
      }),
      app.inject({
        method: 'POST',
        url: `/v1/expense-vouchers/${v.id}/pay`,
        headers: authHeaders(accountantToken),
        payload,
      }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const loser = a.statusCode === 409 ? a : b;
    expect(JSON.parse(loser.body).error.code).toBe('EXPENSE_VOUCHER_INVALID_STATUS');

    // The money moved exactly once.
    const payJes = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'expense_vouchers', sourceId: v.id },
      include: { lines: true },
    });
    expect(payJes).toHaveLength(1);
    const bankCredit = payJes[0]!.lines
      .filter((l) => l.accountCode === '1020')
      .reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(bankCredit).toBe(185000);
  });

  it('list filters by status and sequence increments per month', async () => {
    await cleanup();
    const v1 = await createDraft();
    const v2 = await createDraft();
    expect(v2.voucher_number).not.toBe(v1.voucher_number);
    const seq1 = parseInt(v1.voucher_number.split('-')[2]!, 10);
    const seq2 = parseInt(v2.voucher_number.split('-')[2]!, 10);
    expect(seq2).toBe(seq1 + 1);

    const list = await app.inject({
      method: 'GET',
      url: '/v1/expense-vouchers?status=DRAFT',
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.data.every((v: any) => v.status === 'DRAFT')).toBe(true);
  });
});
