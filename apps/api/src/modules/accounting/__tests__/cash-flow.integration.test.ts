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

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;

const DATE_FROM = '2020-01-01';
const DATE_TO = '2035-12-31';

// A month no other suite writes to, so every flow in it is this file's own.
const MONTH_FROM = '2033-11-01';
const MONTH_TO = '2033-11-30';
// An owner's second bank account: created, not seeded, and cash all the same.
const SECOND_BANK = '1045';
const createdEntryIds: string[] = [];

async function cashFlow(from = DATE_FROM, to = DATE_TO) {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/cash-flow?date_from=${from}&date_to=${to}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
}

async function balanceSheet(asOf: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/balance-sheet?as_of_date=${asOf}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body).data;
}

async function postManual(lines: Array<{ account_code: string; debit_amount: number; credit_amount: number }>) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(ownerToken),
    payload: { entry_date: '2033-11-10', description: 'cash-flow classification', lines },
  });
  expect(res.statusCode, res.body).toBe(201);
  createdEntryIds.push(JSON.parse(res.body).data.id);
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: createdEntryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: SECOND_BANK } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

/**
 * Classification on the REAL seeded chart (docs/25 L-01, L-20). The statement
 * read the section off the counterpart detail account itself, which is always
 * null, so every capital purchase and loan drawdown landed in Operating; and
 * "cash" was a list of three codes, so an owner's second bank account was a
 * counterpart rather than cash.
 */
describe('flows land in the section the chart puts them in', () => {
  it('capex paid from bank is Investing, a bank-loan draw is Financing, a bank-to-bank transfer is no flow', async () => {
    await prisma.chartOfAccounts.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        accountCode: SECOND_BANK,
        accountName: 'Bank Account — Second (cash-flow test)',
        accountClass: 'ASSET',
        accountType: 'DETAIL',
        parentAccountCode: '1000',
        normalBalance: 'DEBIT',
        isCashEquivalent: true,
      },
    });

    await postManual([
      { account_code: '1310', debit_amount: 50000, credit_amount: 0 },
      { account_code: '1020', debit_amount: 0, credit_amount: 50000 },
    ]);
    await postManual([
      { account_code: '1020', debit_amount: 200000, credit_amount: 0 },
      { account_code: '2110', debit_amount: 0, credit_amount: 200000 },
    ]);
    await postManual([
      { account_code: SECOND_BANK, debit_amount: 30000, credit_amount: 0 },
      { account_code: '1020', debit_amount: 0, credit_amount: 30000 },
    ]);

    const cf = await cashFlow(MONTH_FROM, MONTH_TO);
    const codes = (ls: Array<{ account_code: string }>) => ls.map((l) => l.account_code);

    expect(cf.investing_lines).toEqual([expect.objectContaining({ account_code: '1310', amount_pkr: -50000 })]);
    expect(cf.financing_lines).toEqual([expect.objectContaining({ account_code: '2110', amount_pkr: 200000 })]);
    expect(codes(cf.operating_lines)).not.toContain('1310');
    expect(codes(cf.operating_lines)).not.toContain('2110');
    // Moving money between two of the facility's own accounts changes nothing.
    expect(codes(cf.operating_lines)).not.toContain(SECOND_BANK);
    expect(cf.net_change_pkr).toBeCloseTo(150000, 2);

    // The second bank account is cash: it is in the composition, and the
    // closing figure is the balance sheet's cash and cash equivalents.
    expect(codes(cf.cash_composition)).toContain(SECOND_BANK);
    const bs = await balanceSheet(MONTH_TO);
    expect(cf.closing_cash_pkr).toBeCloseTo(bs.cash_and_cash_equivalents_pkr, 2);
    expect(cf.is_reconciled).toBe(true);
  });
});

describe('the statement reconciles to the balance sheet', () => {
  it('opening + net change = closing, and closing equals cash on the balance sheet', async () => {
    const cf = await cashFlow();
    expect(cf.is_reconciled).toBe(true);
    expect(cf.opening_cash_pkr + cf.net_change_pkr).toBeCloseTo(cf.closing_cash_pkr, 2);

    const bs = await balanceSheet(DATE_TO);
    expect(cf.closing_cash_pkr).toBeCloseTo(bs.cash_and_cash_equivalents_pkr, 2);
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
