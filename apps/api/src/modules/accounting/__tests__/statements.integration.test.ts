/**
 * The financial statements read through the ledger kernel (docs/25 L-02, L-16,
 * L-17, L-18, L-21, L-22, L-24). Every describe block owns a month no other
 * suite writes to, so each figure asserted here is this file's own.
 *
 * Rows that the posting engine would refuse today (a legacy posting to 3030, an
 * impairment entry) are inserted directly: they exist on client boxes from
 * before the rules, and the statements must still present them correctly.
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let ownerId: string;
const createdEntryIds: string[] = [];
const createdAssetIds: string[] = [];

async function get(url: string) {
  const res = await app.inject({ method: 'GET', url, headers: authHeaders(ownerToken) });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body).data;
}

async function postManual(date: string, lines: Array<{ account_code: string; debit_amount: number; credit_amount: number }>) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(ownerToken),
    payload: { entry_date: date, description: 'statements.integration', lines },
  });
  expect(res.statusCode, res.body).toBe(201);
  createdEntryIds.push(JSON.parse(res.body).data.id);
}

/** A posted entry the engine would refuse today — as it exists on a box from before the rules. */
async function insertLegacy(
  date: string,
  lines: Array<{ accountCode: string; debit: number; credit: number }>,
  opts: { entryType?: 'ADJUSTMENT' | 'IMPAIRMENT'; sourceTable?: string; sourceId?: string } = {},
) {
  const d = new Date(`${date}T00:00:00.000Z`);
  const id = randomUUID();
  await prisma.journalEntry.create({
    data: {
      id,
      facilityId: TEST_FACILITY_ID,
      entryNumber: `LEG-${id.slice(0, 8)}`,
      entryDate: d,
      entryType: opts.entryType ?? 'ADJUSTMENT',
      bookType: 'PACCI',
      sourceTable: opts.sourceTable ?? 'manual',
      sourceId: opts.sourceId ?? id,
      description: 'legacy row (statements.integration)',
      postingStatus: 'POSTED',
      periodMonth: d.getUTCMonth() + 1,
      periodYear: d.getUTCFullYear(),
      createdBy: ownerId,
      lines: {
        create: lines.map((l, i) => ({
          lineNumber: i + 1,
          accountCode: l.accountCode,
          facilityId: TEST_FACILITY_ID,
          debitAmount: l.debit,
          creditAmount: l.credit,
        })),
      },
    },
  });
  createdEntryIds.push(id);
}

beforeAll(async () => {
  app = await getTestApp();
  const login = await loginAsRole(app, 'OWNER');
  ownerToken = login.accessToken;
  ownerId = login.user.id;
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
    await prisma.fixedAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a legacy posting to the derived equity accounts stays on the balance sheet (L-02)', () => {
  it('3030 carried a posting before the engine refused it — the sheet still balances', async () => {
    // The engine now refuses 3030 from every source, but boxes carry postings
    // from before (pre-update check C10a). The statements excluded 3030 from
    // equity entirely, so any such balance left assets without their other side.
    const before = await get('/v1/accounting/balance-sheet?as_of_date=2037-04-30');
    expect(before.is_balanced).toBe(true);

    await insertLegacy('2037-04-05', [
      { accountCode: '1010', debit: 700, credit: 0 },
      { accountCode: '3030', debit: 0, credit: 700 },
    ]);

    const bs = await get('/v1/accounting/balance-sheet?as_of_date=2037-04-30');
    expect(bs.total_assets_pkr - before.total_assets_pkr).toBeCloseTo(700, 2);
    expect(bs.total_equity_pkr - before.total_equity_pkr).toBeCloseTo(700, 2);
    expect(bs.is_balanced).toBe(true);
    // Posted in the fiscal year the sheet is drawn in: it is this year's result.
    expect(bs.current_year_pl_pkr - before.current_year_pl_pkr).toBeCloseTo(700, 2);

    // A year later it has rolled into retained earnings with the rest of that year.
    const nextYear = await get('/v1/accounting/balance-sheet?as_of_date=2038-04-30');
    expect(nextYear.is_balanced).toBe(true);
  });
});

describe('one equity roll-forward, with the year-end rollover as a transfer (L-24, L-17)', () => {
  // June and July 2038 straddle the default (Pakistan) fiscal-year end.
  const FROM = '2038-06-01';
  const TO = '2038-07-31';

  beforeAll(async () => {
    const bs = await get('/v1/accounting/balance-sheet?as_of_date=2038-07-15');
    expect(bs.fiscal_year_start, 'these assertions assume a July fiscal year').toBe('2038-07-01');
    await postManual('2038-06-10', [
      { account_code: '1010', debit_amount: 100, credit_amount: 0 },
      { account_code: '4150', debit_amount: 0, credit_amount: 100 },
    ]);
    await postManual('2038-07-10', [
      { account_code: '1010', debit_amount: 50, credit_amount: 0 },
      { account_code: '4150', debit_amount: 0, credit_amount: 50 },
    ]);
  });

  it('shows the result once, on the result column, and moves the finished year into retained earnings', async () => {
    const [soce, pl, juneEnd] = await Promise.all([
      get(`/v1/accounting/changes-in-equity?date_from=${FROM}&date_to=${TO}`),
      get(`/v1/accounting/profit-loss?date_from=${FROM}&date_to=${TO}`),
      get('/v1/accounting/balance-sheet?as_of_date=2038-06-30'),
    ]);
    const col = (code: string) => soce.columns.find((c: { account_code: string }) => c.account_code === code);
    const retained = col('3020');
    const current = col('3030');

    // The period's result, once — the same figure as the P&L's bottom line.
    expect(current.result_pkr).toBeCloseTo(pl.net_profit_pkr, 2);
    expect(soce.total_result_pkr).toBeCloseTo(pl.net_profit_pkr, 2);
    // Retained earnings earned nothing in the period; the year that ended on
    // 30 June moved into it, and out of the current-year column, on its own row.
    expect(retained.result_pkr).toBe(0);
    expect(retained.transfer_pkr).toBeCloseTo(juneEnd.current_year_pl_pkr, 2);
    expect(current.transfer_pkr).toBeCloseTo(-juneEnd.current_year_pl_pkr, 2);
    expect(soce.is_reconciled).toBe(true);
  });

  it('a range starting on the fiscal-year start has nothing to transfer', async () => {
    const soce = await get('/v1/accounting/changes-in-equity?date_from=2038-07-01&date_to=2038-07-31');
    for (const c of soce.columns) expect(c.transfer_pkr, c.account_code).toBe(0);
  });

  it('the P&L carries no equity roll-forward of its own, and no back-compat duplicates (L-42)', async () => {
    const pl = await get(`/v1/accounting/profit-loss?date_from=${FROM}&date_to=${TO}`);
    for (const field of ['opening_equity_pkr', 'closing_equity_pkr', 'combined_statement_permitted', 'revenue_lines', 'total_revenue_pkr']) {
      expect(pl, field).not.toHaveProperty(field);
    }
  });

  it('this year’s P&L is the balance sheet’s current-year result', async () => {
    const [pl, bs] = await Promise.all([
      get('/v1/accounting/profit-loss?date_from=2038-07-01&date_to=2038-07-31'),
      get('/v1/accounting/balance-sheet?as_of_date=2038-07-31'),
    ]);
    expect(bs.current_year_pl_pkr).toBeCloseTo(pl.net_profit_pkr, 2);
  });

  it('the trial balance’s section subtotals are the balance sheet’s section totals (L-16, L-18)', async () => {
    const [tb, bs] = await Promise.all([
      get(`/v1/accounting/trial-balance?date_to=${TO}`),
      get(`/v1/accounting/balance-sheet?as_of_date=${TO}`),
    ]);
    const net = (section: string, side: 'DEBIT' | 'CREDIT') => {
      const g = tb.section_groups.find((s: { statement_section: string }) => s.statement_section === section);
      if (!g) return 0;
      const d = g.subtotal.debit_balance_pkr - g.subtotal.credit_balance_pkr;
      return side === 'DEBIT' ? d : -d;
    };
    expect(net('CURRENT_ASSET', 'DEBIT')).toBeCloseTo(bs.total_current_assets_pkr, 2);
    expect(net('NON_CURRENT_ASSET', 'DEBIT')).toBeCloseTo(bs.total_non_current_assets_pkr, 2);
    expect(net('CURRENT_LIABILITY', 'CREDIT')).toBeCloseTo(bs.total_current_liabilities_pkr, 2);
    expect(tb.is_balanced).toBe(true);
  });
});

describe('EBITDA adds back depreciation and impairment, and nothing else (L-21)', () => {
  it('a legacy asset depreciating into 6100 does not add Miscellaneous back; impairment is its own row', async () => {
    // Before the registry, an OTHER-category asset defaulted its depreciation
    // expense to 6100 Miscellaneous — and EBITDA added back every account any
    // asset named, so the whole Miscellaneous balance was treated as D&A.
    const asset = await prisma.fixedAsset.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        assetNumber: `FA-L21-${Date.now() % 1000000}`,
        assetName: 'Legacy other-category asset',
        assetCategory: 'OTHER',
        assetAccountCode: '1310',
        accumDeprAccountCode: '1311',
        deprExpenseAccountCode: '6100',
        purchaseDate: new Date('2037-01-05T00:00:00.000Z'),
        purchaseCostPkr: 10000,
        usefulLifeYears: 5,
        depreciationMethod: 'SLM',
        createdBy: ownerId,
      },
    });
    createdAssetIds.push(asset.id);

    await postManual('2037-02-10', [
      { account_code: '6100', debit_amount: 1000, credit_amount: 0 },
      { account_code: '1010', debit_amount: 0, credit_amount: 1000 },
    ]);
    await insertLegacy(
      '2037-02-20',
      [
        { accountCode: '6160', debit: 400, credit: 0 },
        { accountCode: '1370', debit: 0, credit: 400 },
      ],
      { entryType: 'IMPAIRMENT', sourceTable: 'fixed_assets', sourceId: asset.id },
    );

    const pl = await get('/v1/accounting/profit-loss?date_from=2037-02-01&date_to=2037-02-28');
    expect(pl.depreciation_amortisation_pkr).toBe(0);
    expect(pl.impairment_pkr).toBe(400);
    expect(pl.ebitda_pkr).toBeCloseTo(pl.operating_profit_pkr + 400, 2);
  });
});
