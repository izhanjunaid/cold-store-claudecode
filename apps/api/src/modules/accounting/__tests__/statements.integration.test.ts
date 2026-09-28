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
