/**
 * Virtual closing (phase/19 audit): the balance sheet's "Current Year
 * Profit/(Loss)" must cover only the fiscal year containing as_of_date; earlier
 * years' net result rolls into Retained Earnings. No closing JE is posted, so
 * total equity is unchanged from the old since-inception computation — only its
 * presentation splits. Facility default fiscal year starts in July.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let managerToken: string;
let accountantToken: string;

async function wipeJournals() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

async function postRevenue(entryDate: string, amount: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(managerToken),
    payload: {
      entry_date: entryDate,
      description: `fy test revenue ${entryDate}`,
      posting_status: 'POSTED',
      lines: [
        { account_code: '1010', debit_amount: amount, credit_amount: 0 },
        { account_code: '4050', debit_amount: 0, credit_amount: amount },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
}

async function balanceSheet(asOf: string) {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/balance-sheet?as_of_date=${asOf}`,
    headers: authHeaders(accountantToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
}

beforeAll(async () => {
  app = await getTestApp();
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  await wipeJournals();
}, 30_000);

afterAll(async () => {
  await wipeJournals();
  await prisma.$disconnect();
  await closeTestApp();
});

describe('balance sheet — fiscal-year virtual closing', () => {
  it('splits current-FY profit from prior-year results, keeping equity and balance intact', async () => {
    // FY starts July. Prior FY (2024-07..2025-06) revenue 3000; current FY
    // (2025-07..2026-06) revenue 5000. Both add cash on the asset side.
    await postRevenue('2025-05-10', 3000); // prior fiscal year
    await postRevenue('2025-08-10', 5000); // current fiscal year

    const bs = await balanceSheet('2026-06-30');

    expect(bs.fiscal_year_start).toBe('2025-07-01');
    expect(bs.current_year_pl_pkr).toBeCloseTo(5000);
    expect(bs.prior_years_pl_pkr).toBeCloseTo(3000);
    // No posted 3020 yet → retained earnings is exactly the prior-year result.
    expect(bs.retained_earnings_pkr).toBeCloseTo(3000);

    // Assets = cash 8000; equity = capital(0) + retained(3000) + current(5000).
    expect(bs.total_assets_pkr).toBeCloseTo(8000);
    expect(bs.total_equity_pkr).toBeCloseTo(8000);
    // Retained + current must equal the whole since-inception result (8000).
    expect(bs.retained_earnings_pkr + bs.current_year_pl_pkr).toBeCloseTo(8000);
    expect(bs.is_balanced).toBe(true);
  });

  it('reports zero current and prior P&L when as_of precedes every posting', async () => {
    const bs = await balanceSheet('2024-01-01');
    expect(bs.current_year_pl_pkr).toBeCloseTo(0);
    expect(bs.prior_years_pl_pkr).toBeCloseTo(0);
    expect(bs.retained_earnings_pkr).toBeCloseTo(0);
    expect(bs.is_balanced).toBe(true);
  });
});
