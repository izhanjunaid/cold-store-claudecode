/**
 * Sales tax settlement (JE-26) — backlog P1-4.
 *
 * 2020 GST Payable was credited by JE-01 on every invoice and debited by
 * nothing, so the liability grew without bound and the balance sheet
 * permanently overstated it. This is the missing debit.
 *
 * Two properties carry the design:
 *   1. the settlement clears output tax accrued through the period end, net of
 *      input tax, and moves exactly the net from the bank;
 *   2. re-running a settled period settles nothing. That is load-bearing —
 *      the entry is dated AFTER the period end, so a naive "balance as of the
 *      period end" would never see its own debit and would settle twice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;

// Far enough out that no other fixture posts here, so the period's own figures
// are entirely ours. Balances carried from real dev data still show up in the
// outstanding total, which is why every assertion below is on a delta.
const YEAR = 2033;
const MONTH = 6;
const OUTPUT_TAX = 4000;
const INPUT_TAX = 1500;

const createdEntryIds: string[] = [];

async function postManual(entryDate: string, description: string, lines: unknown[]) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(ownerToken),
    payload: { entry_date: entryDate, description, lines },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = JSON.parse(res.body).data.id as string;
  createdEntryIds.push(id);
  return id;
}

async function preview(year = YEAR, month = MONTH) {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/gst-settlement?period_year=${year}&period_month=${month}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body).data;
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  // Everything this file posts is POSTED and trigger-immutable, and leaving a
  // settlement behind would zero 2020 for every later run of this suite.
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: createdEntryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the settlement clears output tax net of input tax', () => {
  it('previews the period and the outstanding position separately', async () => {
    const before = await preview();

    // Output tax collected in cash, and input tax paid out — the shape JE-01
    // and a taxable purchase leave behind.
    await postManual(`${YEAR}-06-15`, 'Test output tax', [
      { account_code: '1010', debit_amount: OUTPUT_TAX, credit_amount: 0 },
      { account_code: '2020', debit_amount: 0, credit_amount: OUTPUT_TAX },
    ]);
    await postManual(`${YEAR}-06-10`, 'Test input tax', [
      { account_code: '1260', debit_amount: INPUT_TAX, credit_amount: 0 },
      { account_code: '1010', debit_amount: 0, credit_amount: INPUT_TAX },
    ]);

    const after = await preview();
    // The period's own figures are ours alone; the outstanding total also
    // carries whatever the dev facility already had, so compare the delta.
    expect(after.period_output_tax_pkr).toBeCloseTo(before.period_output_tax_pkr + OUTPUT_TAX, 2);
    expect(after.period_input_tax_pkr).toBeCloseTo(before.period_input_tax_pkr + INPUT_TAX, 2);
    expect(after.outstanding_output_tax_pkr).toBeCloseTo(
      before.outstanding_output_tax_pkr + OUTPUT_TAX,
      2,
    );
    expect(after.net_payable_pkr).toBeCloseTo(
      after.outstanding_output_tax_pkr - after.input_tax_applied_pkr,
      2,
    );
  });

  it('refuses a payment date before the period has closed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/gst-settlement',
      headers: authHeaders(ownerToken),
      payload: { period_year: YEAR, period_month: MONTH, payment_date: `${YEAR}-06-20` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('payment_date');
  });

  it('refuses to remit from an account that is not cash or bank', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/gst-settlement',
      headers: authHeaders(ownerToken),
      payload: {
        period_year: YEAR,
        period_month: MONTH,
        payment_date: `${YEAR}-07-15`,
        bank_account_code: '4010',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('posts DR 2020 / CR 1260 / CR bank and leaves 2020 clear', async () => {
    const before = await preview();
    expect(before.outstanding_output_tax_pkr).toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/gst-settlement',
      headers: authHeaders(ownerToken),
      payload: { period_year: YEAR, period_month: MONTH, payment_date: `${YEAR}-07-15` },
    });
    expect(res.statusCode, res.body).toBe(201);
    const result = JSON.parse(res.body).data;
    createdEntryIds.push(result.journal_entry_id);

    expect(result.output_tax_pkr).toBeCloseTo(before.outstanding_output_tax_pkr, 2);
    expect(result.input_tax_applied_pkr).toBeCloseTo(before.input_tax_applied_pkr, 2);
    expect(result.net_remitted_pkr).toBeCloseTo(before.net_payable_pkr, 2);

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: result.journal_entry_id },
      orderBy: { lineNumber: 'asc' },
    });
    const by = (code: string) => lines.find((l) => l.accountCode === code);
    expect(Number(by('2020')!.debitAmount)).toBeCloseTo(result.output_tax_pkr, 2);
    expect(Number(by('1260')!.creditAmount)).toBeCloseTo(result.input_tax_applied_pkr, 2);
    expect(Number(by('1020')!.creditAmount)).toBeCloseTo(result.net_remitted_pkr, 2);

    // The whole point: 2020 no longer carries the settled tax.
    const after = await preview();
    expect(after.outstanding_output_tax_pkr).toBeCloseTo(0, 2);
  });

  it('settles a period only once, even though the entry is dated after it', async () => {
    // The entry landed in July while the period ends 30 June. A balance read
    // at the period end would not see the debit and would settle again.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/gst-settlement',
      headers: authHeaders(ownerToken),
      payload: { period_year: YEAR, period_month: MONTH, payment_date: `${YEAR}-08-15` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('nothing to settle');
  });

  it('rolls a later period forward without double-counting the settled one', async () => {
    await postManual(`${YEAR}-09-15`, 'Test output tax, later period', [
      { account_code: '1010', debit_amount: 900, credit_amount: 0 },
      { account_code: '2020', debit_amount: 0, credit_amount: 900 },
    ]);
    const sep = await preview(YEAR, 9);
    expect(sep.period_output_tax_pkr).toBeCloseTo(900, 2);
    // Only September's tax is outstanding — June's was already settled.
    expect(sep.outstanding_output_tax_pkr).toBeCloseTo(900, 2);
    expect(sep.includes_earlier_periods).toBe(false);
  });
});
