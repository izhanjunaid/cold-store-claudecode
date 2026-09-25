/**
 * The ledger read path and the posting rules (docs/25 §2 invariants 2–4).
 *
 * classify() is exercised on the REAL seeded chart rows. The cash-flow statement
 * sent every capital purchase to Operating for its whole life while its tests
 * stayed green, because those tests built account objects with a statement
 * section that no real DETAIL row ever carries (docs/25 L-01). A classification
 * test that constructs its own accounts proves nothing about the chart.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { accountBalances, classify, partyBalances, signedBalance, type ClassifiableAccount } from '../ledger';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let partyId: string;
const createdEntryIds: string[] = [];

const DATE = '2031-03-14'; // a month no other suite writes to, so balances are this file's alone

async function postManual(lines: Array<{ account_code: string; debit_amount: number; credit_amount: number; party_id?: string }>) {
  return app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(ownerToken),
    payload: { entry_date: DATE, description: 'ledger.integration', lines },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(ownerToken),
    payload: {
      name: `Ledger Party ${Date.now()}`,
      party_type: 'TRADER',
      phone_primary: `0315${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  partyId = JSON.parse(res.body).data.id;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const reversals = await prisma.journalEntry.findMany({
      where: { id: { in: createdEntryIds } },
      select: { reversedById: true },
    });
    const ids = [...createdEntryIds, ...reversals.map((r) => r.reversedById).filter((x): x is string => !!x)];
    await prisma.journalEntry.updateMany({ where: { id: { in: ids } }, data: { reversedById: null } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('classify() on the seeded chart', () => {
  let chart: Map<string, ClassifiableAccount>;

  beforeAll(async () => {
    const rows = await prisma.chartOfAccounts.findMany({ where: { facilityId: TEST_FACILITY_ID } });
    chart = new Map(rows.map((r) => [r.accountCode, r]));
  });

  const cases: Array<[string, string, string]> = [
    ['1010', 'CURRENT_ASSET', 'CASH'],
    ['1020', 'CURRENT_ASSET', 'CASH'],
    // A received cheque can still bounce: not cash until it clears.
    ['1025', 'CURRENT_ASSET', 'OPERATING'],
    ['1140', 'CURRENT_ASSET', 'OPERATING'],
    ['1310', 'NON_CURRENT_ASSET', 'INVESTING'],
    ['1380', 'NON_CURRENT_ASSET', 'INVESTING'],
    ['2050', 'CURRENT_LIABILITY', 'OPERATING'],
    ['2110', 'NON_CURRENT_LIABILITY', 'FINANCING'],
    ['2120', 'NON_CURRENT_LIABILITY', 'FINANCING'],
    ['3010', 'EQUITY', 'FINANCING'],
    ['4150', 'REVENUE', 'OPERATING'],
    ['6110', 'OTHER_EXPENSE', 'OPERATING'],
  ];

  it.each(cases)('%s sits in %s and its cash moves as %s', (code, section, cashFlow) => {
    const account = chart.get(code);
    expect(account, `${code} missing from the seeded chart`).toBeTruthy();
    expect(classify(account!, chart)).toEqual({ section, cashFlow });
  });
});

describe('balances read through the ledger', () => {
  it('a manual entry and its reversal net every account back to zero', async () => {
    const before = await accountBalances(prisma, { facilityId: TEST_FACILITY_ID, book: 'PACCI', accounts: ['1010', '4150'] });

    const posted = await postManual([
      { account_code: '1010', debit_amount: 750, credit_amount: 0 },
      { account_code: '4150', debit_amount: 0, credit_amount: 750 },
    ]);
    expect(posted.statusCode, posted.body).toBe(201);
    const entry = JSON.parse(posted.body).data;
    createdEntryIds.push(entry.id);

    const reversed = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${entry.id}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'ledger test', entry_date: DATE },
    });
    expect(reversed.statusCode, reversed.body).toBe(201);

    const after = await accountBalances(prisma, { facilityId: TEST_FACILITY_ID, book: 'PACCI', accounts: ['1010', '4150'] });
    for (const code of ['1010', '4150']) {
      expect(signedBalance(after.get(code), 'DEBIT')).toBe(signedBalance(before.get(code), 'DEBIT'));
    }
  });

  it('partyBalances reads a party-level AR line straight from the ledger', async () => {
    const posted = await postManual([
      { account_code: '1120', debit_amount: 1200, credit_amount: 0, party_id: partyId },
      { account_code: '4150', debit_amount: 0, credit_amount: 1200 },
    ]);
    expect(posted.statusCode, posted.body).toBe(201);
    createdEntryIds.push(JSON.parse(posted.body).data.id);

    const byParty = await partyBalances(prisma, {
      facilityId: TEST_FACILITY_ID,
      book: 'PACCI',
      accounts: ['1110', '1120', '1130', '1150'],
      partyId,
    });
    expect(signedBalance(byParty.get(partyId), 'DEBIT')).toBe(1200);
  });
});

describe('posting rules (manual-posting matrix)', () => {
  it('refuses an AR line that names no party', async () => {
    const res = await postManual([
      { account_code: '1120', debit_amount: 100, credit_amount: 0 },
      { account_code: '4150', debit_amount: 0, credit_amount: 100 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toMatch(/must name a party/);
  });

  it('refuses a manual line on an account only its own documents move', async () => {
    const res = await postManual([
      { account_code: '1025', debit_amount: 100, credit_amount: 0 },
      { account_code: '4150', debit_amount: 0, credit_amount: 100 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toMatch(/moved only by its own documents/);
  });

  it('refuses the current-year result, which is computed and never posted', async () => {
    const res = await postManual([
      { account_code: '3030', debit_amount: 100, credit_amount: 0 },
      { account_code: '1010', debit_amount: 0, credit_amount: 100 },
    ]);
    expect(res.statusCode).toBe(400);
  });
});
