/**
 * Statement of Cash Flows (IFRS for SMEs §7), direct method.
 *
 * It was specified in docs/01, docs/04 and docs/10 and never built — a
 * required primary statement with zero implementation.
 *
 * Two properties matter more than the totals:
 *   1. closing cash on the statement equals cash on the balance sheet at the
 *      same date, or the statement is lying;
 *   2. a cheque received and later cleared is ONE inflow, not two. 1025
 *      Cheques in Hand is not cash — a cheque can still bounce, which is why
 *      phase/25 created the account — so the receipt is not a cash movement
 *      and only the clearing entry is.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { deriveCashFlowSection } from '../cash-flow.service';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;

const DATE_FROM = '2020-01-01';
const DATE_TO = '2035-12-31';

async function cashFlow() {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/cash-flow?date_from=${DATE_FROM}&date_to=${DATE_TO}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the derivation places accounts without anyone tagging them', () => {
  const base = { accountCode: 'X', accountName: 'X', cashFlowSection: null };

  it('sends non-current assets to investing and non-current liabilities to financing', () => {
    expect(deriveCashFlowSection({ ...base, accountClass: 'ASSET', statementSection: 'NON_CURRENT_ASSET' })).toBe('INVESTING');
    expect(deriveCashFlowSection({ ...base, accountClass: 'LIABILITY', statementSection: 'NON_CURRENT_LIABILITY' })).toBe('FINANCING');
  });

  it('sends equity to financing regardless of section', () => {
    expect(deriveCashFlowSection({ ...base, accountClass: 'EQUITY', statementSection: null })).toBe('FINANCING');
  });

  it('sends working capital and P&L accounts to operating', () => {
    expect(deriveCashFlowSection({ ...base, accountClass: 'ASSET', statementSection: 'CURRENT_ASSET' })).toBe('OPERATING');
    expect(deriveCashFlowSection({ ...base, accountClass: 'REVENUE', statementSection: 'REVENUE' })).toBe('OPERATING');
    expect(deriveCashFlowSection({ ...base, accountClass: 'EXPENSE', statementSection: 'OPERATING_EXPENSE' })).toBe('OPERATING');
  });

  it('lets an explicit tag win — that is the whole reason the column exists', () => {
    // 1140 peshgi is a current asset, so it derives to operating anyway; the
    // tag pins it so a later reclassification cannot silently move it.
    expect(
      deriveCashFlowSection({ ...base, accountClass: 'ASSET', statementSection: 'NON_CURRENT_ASSET', cashFlowSection: 'OPERATING' }),
    ).toBe('OPERATING');
  });

  it('defaults an unclassified account to operating rather than dropping it', () => {
    expect(deriveCashFlowSection({ ...base, accountClass: 'EXPENSE', statementSection: null })).toBe('OPERATING');
  });
});

describe('the statement reconciles to the balance sheet', () => {
  it('opening + net change = closing, and closing equals cash on the balance sheet', async () => {
    const cf = await cashFlow();
    expect(cf.is_reconciled).toBe(true);
    expect(cf.opening_cash_pkr + cf.net_change_pkr).toBeCloseTo(cf.closing_cash_pkr, 2);

    // Same figure the balance sheet shows for 1010 + 1020 + 1030.
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: { in: ['1010', '1020', '1030'] },
        journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI', entryDate: { lte: new Date(`${DATE_TO}T00:00:00.000Z`) } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const balanceSheetCash =
      Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100;
    expect(cf.closing_cash_pkr).toBeCloseTo(balanceSheetCash, 2);
  });

  it('discloses cheques in hand separately instead of counting them as cash', async () => {
    const cf = await cashFlow();
    expect(cf).toHaveProperty('cheques_in_hand_pkr');
    expect(cf.cash_composition.every((l: { account_code: string }) => l.account_code !== '1025')).toBe(true);
  });
});

describe('a cheque is one inflow, not two', () => {
  it('counts the clearing, not the receipt — 1025 is not cash until it clears', async () => {
    const before = await cashFlow();

    const party = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(ownerToken),
      payload: {
        name: `Cashflow Cheque Party ${Date.now()}`,
        party_type: 'TRADER',
        phone_primary: `0311${Date.now() % 10000000}`.slice(0, 11),
        credit_terms_days: 30,
      },
    });
    expect(party.statusCode).toBe(201);
    const partyId = JSON.parse(party.body).data.id as string;

    // An on-account cheque receipt: DR 1025 / CR 2010. No cash has moved.
    const pay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-03-01',
        amount_pkr: 5000,
        payment_method: 'CHEQUE',
        cheque_number: `CF-${Date.now() % 100000}`,
        allocations: [],
      },
    });
    expect(pay.statusCode).toBe(201);
    const paymentId = JSON.parse(pay.body).data.id as string;

    const afterReceipt = await cashFlow();
    expect(
      afterReceipt.net_change_pkr,
      'a cheque sitting in hand is not cash — it can still bounce',
    ).toBeCloseTo(before.net_change_pkr, 2);

    // Clearing it moves the money: DR 1020 / CR 1025.
    const clear = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/clear`,
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(clear.statusCode).toBe(200);

    const afterClearing = await cashFlow();
    expect(afterClearing.net_change_pkr - before.net_change_pkr).toBeCloseTo(5000, 2);
    expect(afterClearing.is_reconciled).toBe(true);

    // Clean up: the payment's journal entries are posted and immutable.
    await withGuardsDisabled(prisma, async () => {
      const payments = await prisma.payment.findMany({ where: { partyId }, select: { id: true, journalEntryId: true } });
      const jeIds = payments.map((p) => p.journalEntryId).filter((x): x is string => x !== null);
      const clearing = await prisma.journalEntry.findMany({
        where: { facilityId: TEST_FACILITY_ID, entryType: 'CHEQUE_CLEARED', sourceId: { in: payments.map((p) => p.id) } },
        select: { id: true },
      });
      const allJe = [...jeIds, ...clearing.map((c) => c.id)];
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
      await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: allJe } } });
      await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: allJe } } });
      await prisma.party.deleteMany({ where: { id: partyId } });
    });
  });
});
