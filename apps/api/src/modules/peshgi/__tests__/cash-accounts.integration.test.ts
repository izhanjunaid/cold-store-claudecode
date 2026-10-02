import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../../test/helpers';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { billingFixture } from '../../invoice/__tests__/billing-fixture';

/**
 * "Paid from / received into" is any account the chart marks cash-equivalent —
 * never a list of codes (docs/25 R-19, R-33, L-20). The GST settlement accepted
 * only 1010/1020/1030, so an owner's second bank account was refused; peshgi
 * accepted any code at all, so a loan could be "paid out" of a revenue account.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const OWN_BANK = '1045';
const entries: string[] = [];

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
  await prisma.chartOfAccounts.upsert({
    where: { facilityId_accountCode: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } },
    update: {},
    create: {
      facilityId: TEST_FACILITY_ID,
      accountCode: OWN_BANK,
      accountName: 'Second bank — cash account test',
      accountClass: 'ASSET',
      accountType: 'DETAIL',
      parentAccountCode: '1000',
      normalBalance: 'DEBIT',
      isCashEquivalent: true,
    },
  });
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await withGuardsDisabled(prisma, async () => {
    const settlements = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, OR: [{ id: { in: entries } }, { sourceTable: 'gst_settlement', entryDate: { gte: new Date('2034-01-01') } }] },
      select: { id: true },
    });
    const ids = settlements.map((e) => e.id);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('cash accounts come from the chart flag', () => {
  it('sales tax can be remitted from an owner-added bank account, never from a non-cash account', async () => {
    const tax = await fx.call('POST', '/v1/accounting/journal-entries', fx.tokens.owner, {
      entry_date: '2034-03-10',
      description: 'output tax for the cash-account test',
      lines: [
        { account_code: '1010', debit_amount: 500, credit_amount: 0 },
        { account_code: '2020', debit_amount: 0, credit_amount: 500 },
      ],
    });
    expect(tax.status).toBe(201);
    entries.push(tax.body.data.id);

    const bad = await fx.call('POST', '/v1/accounting/gst-settlement', fx.tokens.owner, {
      period_year: 2034, period_month: 3, payment_date: '2034-04-10', bank_account_code: '1025',
    });
    expect(bad.status).toBe(400);
    const ok = await fx.call('POST', '/v1/accounting/gst-settlement', fx.tokens.owner, {
      period_year: 2034, period_month: 3, payment_date: '2034-04-10', bank_account_code: OWN_BANK,
    });
    expect(ok.status).toBe(201);
  });

  it('a peshgi is paid out of, and repaid into, cash-equivalent accounts only', async () => {
    const partyId = await fx.party('Cash Account Loan Party');
    const bad = await fx.call('POST', '/v1/loans/issue', fx.tokens.owner, {
      party_id: partyId, issue_date: '2026-08-01', principal_pkr: 1000, payment_method: 'BANK_TRANSFER',
      source_asset_account_code: '4010',
    });
    expect(bad.status).toBe(400);

    const loan = await fx.call('POST', '/v1/loans/issue', fx.tokens.owner, {
      party_id: partyId, issue_date: '2026-08-01', principal_pkr: 1000, payment_method: 'BANK_TRANSFER',
      source_asset_account_code: OWN_BANK,
    });
    expect(loan.status).toBe(201);
    const repayBad = await fx.call('POST', `/v1/loans/${loan.body.data.id}/repayments`, fx.tokens.owner, {
      repayment_date: '2026-08-05', amount_pkr: 100, payment_method: 'CASH', asset_account_code: '4010',
    });
    expect(repayBad.status).toBe(400);
  });
});
