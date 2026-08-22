/**
 * Withholding tax on payments the facility makes (Income Tax Ordinance 2001
 * s.153 / s.155), and the s.165-shaped report over it.
 *
 * The facility is a withholding agent. 2070 existed but carries s.149 salary
 * withholding only, so tax deducted from a supplier had nowhere to go and
 * either was not deducted or silently vanished into the payment.
 *
 * The gating assertion is the first one: a voucher paid WITHOUT withholding
 * must produce exactly the journal lines it did before. Every expense the
 * facility has ever paid takes that path, and it is the line between an
 * additive change and a regression in all of them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let accountantToken: string;
const createdVoucherIds: string[] = [];
const createdEntryIds: string[] = [];

const AMOUNT = 50_000;
const WITHHELD = 5_000;
const PAY_DATE = '2033-03-15';

async function createApprovedVoucher(vendor: string, expenseAccount = '6030') {
  const create = await app.inject({
    method: 'POST',
    url: '/v1/expense-vouchers',
    headers: authHeaders(accountantToken),
    payload: {
      voucher_date: PAY_DATE,
      expense_account_code: expenseAccount,
      description: `Withholding test — ${vendor}`,
      vendor_name: vendor,
      amount_pkr: AMOUNT,
    },
  });
  expect(create.statusCode, create.body).toBe(201);
  const id = JSON.parse(create.body).data.id as string;
  createdVoucherIds.push(id);

  const approve = await app.inject({
    method: 'POST',
    url: `/v1/expense-vouchers/${id}/approve`,
    headers: authHeaders(ownerToken),
    payload: {},
  });
  expect(approve.statusCode, approve.body).toBe(200);
  return id;
}

async function pay(id: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/v1/expense-vouchers/${id}/pay`,
    headers: authHeaders(ownerToken),
    payload: {
      payment_date: PAY_DATE,
      payment_method: 'BANK_TRANSFER',
      asset_account_code: '1020',
      ...extra,
    },
  });
}

const linesOf = (journalEntryId: string) =>
  prisma.journalEntryLine.findMany({ where: { journalEntryId }, orderBy: { lineNumber: 'asc' } });

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  // Vouchers are created by one person and approved by another — segregation
  // of duties is enforced, so a single token cannot drive this fixture.
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const jes = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'expense_vouchers', sourceId: { in: createdVoucherIds } },
      select: { id: true },
    });
    const jeIds = [...jes.map((j) => j.id), ...createdEntryIds];
    await prisma.expenseVoucher.updateMany({
      where: { id: { in: createdVoucherIds } },
      data: { accrualJournalEntryId: null, paymentJournalEntryId: null },
    });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.expenseVoucher.deleteMany({ where: { id: { in: createdVoucherIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a payment without withholding is untouched', () => {
  it('posts exactly two lines: the expense and the full payment', async () => {
    const id = await createApprovedVoucher(`No WHT Vendor ${Date.now()}`);
    const res = await pay(id);
    expect(res.statusCode, res.body).toBe(201);

    const voucher = JSON.parse(res.body).data;
    const lines = await linesOf(voucher.payment_journal_entry_id);
    expect(lines).toHaveLength(2);
    expect(Number(lines.find((l) => l.accountCode === '6030')!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === '1020')!.creditAmount)).toBeCloseTo(AMOUNT, 2);
    expect(lines.some((l) => l.accountCode === '2071' || l.accountCode === '2072')).toBe(false);
  });
});

describe('a payment with withholding', () => {
  it('books the expense gross, pays net, and holds the difference in 2071', async () => {
    const id = await createApprovedVoucher(`WHT Vendor ${Date.now()}`);
    const res = await pay(id, { tax_withheld_pkr: WITHHELD, withholding_section: 'S153' });
    expect(res.statusCode, res.body).toBe(201);

    const lines = await linesOf(JSON.parse(res.body).data.payment_journal_entry_id);
    // The cost does not shrink because tax was deducted — that is what the
    // supplier earned and what the facility is liable for.
    expect(Number(lines.find((l) => l.accountCode === '6030')!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === '2071')!.creditAmount)).toBeCloseTo(WITHHELD, 2);
    expect(Number(lines.find((l) => l.accountCode === '1020')!.creditAmount)).toBeCloseTo(
      AMOUNT - WITHHELD,
      2,
    );

    const totalD = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalC = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalD).toBeCloseTo(totalC, 2);
  });

  it('routes rent to 2072, because s.165 reports the sections separately', async () => {
    const id = await createApprovedVoucher(`Rent Vendor ${Date.now()}`, '6020');
    const res = await pay(id, { tax_withheld_pkr: WITHHELD, withholding_section: 'S155' });
    expect(res.statusCode, res.body).toBe(201);
    const lines = await linesOf(JSON.parse(res.body).data.payment_journal_entry_id);
    expect(Number(lines.find((l) => l.accountCode === '2072')!.creditAmount)).toBeCloseTo(WITHHELD, 2);
  });

  it('insists on a section, since the figures cannot be reported without one', async () => {
    const id = await createApprovedVoucher(`No Section Vendor ${Date.now()}`);
    const res = await pay(id, { tax_withheld_pkr: WITHHELD });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('withholding_section');
  });

  it('refuses to withhold more than the voucher is worth', async () => {
    const id = await createApprovedVoucher(`Over WHT Vendor ${Date.now()}`);
    const res = await pay(id, { tax_withheld_pkr: AMOUNT * 2, withholding_section: 'S153' });
    expect(res.statusCode).toBe(400);
  });
});

describe('the s.165 report', () => {
  it('reports by section, names the payee, and ties to the GL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/withholding-tax?date_from=2033-01-01&date_to=2033-12-31',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = JSON.parse(res.body).data;

    const s153 = report.sections.find((s: { section: string }) => s.section === 'S153');
    const s155 = report.sections.find((s: { section: string }) => s.section === 'S155');
    expect(s153.account_code).toBe('2071');
    expect(s155.account_code).toBe('2072');
    expect(s153.withheld_pkr).toBeGreaterThanOrEqual(WITHHELD);
    expect(s155.withheld_pkr).toBeGreaterThanOrEqual(WITHHELD);

    // Every section's arithmetic must close, or the report is telling a
    // different story than the ledger it is built from.
    for (const s of report.sections) {
      expect(s.closing_balance_pkr).toBeCloseTo(
        s.opening_balance_pkr + s.withheld_pkr - s.remitted_pkr,
        2,
      );
      expect(s.rows.reduce((t: number, r: { withheld_pkr: number }) => t + r.withheld_pkr, 0)).toBeCloseTo(
        s.withheld_pkr,
        2,
      );
    }

    // The payee is resolved from the voucher, not left as a voucher number.
    expect(s153.rows.some((r: { counterparty: string }) => r.counterparty.startsWith('WHT Vendor'))).toBe(true);

    // s.149 is included: salary withholding is part of the same statement.
    expect(report.sections.some((s: { section: string }) => s.section === 'S149')).toBe(true);
  });
});

describe('paying the withheld tax over', () => {
  const remit = (section: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/accounting/withholding-remittance',
      headers: authHeaders(ownerToken),
      payload: { section, period_year: 2033, period_month: 3, payment_date: '2033-04-15', ...extra },
    });

  const outstanding = async (section: 'S153' | 'S155') => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/reports/withholding-tax?date_from=2033-01-01&date_to=2033-03-31',
      headers: authHeaders(ownerToken),
    });
    // unremitted, not closing: the remittance is dated after the period end,
    // so the balance AT 31 March stays what was owed then while the amount
    // still to pay goes to zero. Those are two different, both-correct numbers.
    return JSON.parse(res.body).data.sections.find((s: { section: string }) => s.section === section)
      .unremitted_pkr as number;
  };

  it('clears 2071 and takes the money from the bank', async () => {
    const before = await outstanding('S153');
    expect(before).toBeGreaterThan(0);

    const res = await remit('S153');
    expect(res.statusCode, res.body).toBe(201);
    const result = JSON.parse(res.body).data;
    createdEntryIds.push(result.journal_entry_id);
    expect(result.amount_pkr).toBeCloseTo(before, 2);

    const lines = await linesOf(result.journal_entry_id);
    expect(Number(lines.find((l) => l.accountCode === '2071')!.debitAmount)).toBeCloseTo(before, 2);
    expect(Number(lines.find((l) => l.accountCode === '1020')!.creditAmount)).toBeCloseTo(before, 2);

    // Without this the liability grows forever — the same defect that made
    // 2020 GST Payable wrong, reproduced the moment withholding was built.
    expect(await outstanding('S153')).toBeCloseTo(0, 2);
  });

  it('pays a period over only once, though the entry is dated after it', async () => {
    const res = await remit('S153', { payment_date: '2033-05-15' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('nothing to pay over');
  });

  it('refuses s.149 — salary tax is paid over from the payroll run that withheld it', async () => {
    const res = await remit('S149');
    expect(res.statusCode).toBe(400);
  });

  it('refuses a payment date before the period closed', async () => {
    const res = await remit('S155', { payment_date: '2033-03-20' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('payment_date');
  });
});
