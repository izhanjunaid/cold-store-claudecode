/**
 * Impairment of fixed assets (IFRS for SMEs Section 27; backlog P2-7).
 *
 * Section 27 requires an assessment at each reporting date and there was no
 * mechanism at all. A failed compressor or a flood-damaged building is a
 * realistic indicator for a cold store.
 *
 * Recording the loss is the easy half. The three assertions that matter are
 * the consequences, because each is a defect if it is missed:
 *   1. carrying amount drops — 1370 is a contra under 1300, so the balance
 *      sheet must fall without any statement-side change;
 *   2. later depreciation spreads the REVISED carrying amount over the
 *      REMAINING life (27.10). Keeping the original cost-based charge would
 *      depreciate an impaired asset past its residual value;
 *   3. disposal clears 1370. Leaving it behind strands the write-down against
 *      an asset that no longer exists and books the loss a second time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { computeMonthlyDepreciation } from '../depreciation-calc';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
const createdAssetIds: string[] = [];

const COST = 1_200_000;
const LIFE_YEARS = 10;

async function createAsset(name: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fixed-assets',
    headers: authHeaders(ownerToken),
    payload: {
      asset_name: name,
      asset_category: 'COLD_PLANT',
      purchase_date: '2030-01-05',
      purchase_cost_pkr: COST,
      residual_value_pkr: 0,
      useful_life_years: LIFE_YEARS,
      depreciation_method: 'SLM',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const asset = JSON.parse(res.body).data;
  createdAssetIds.push(asset.id);

  const commission = await app.inject({
    method: 'POST',
    url: `/v1/fixed-assets/${asset.id}/commission`,
    headers: authHeaders(ownerToken),
    payload: { depreciation_start_date: '2030-01-05' },
  });
  expect(commission.statusCode, commission.body).toBe(200);
  return asset.id as string;
}

async function impair(id: string, amount: number, date = '2030-06-30') {
  return app.inject({
    method: 'POST',
    url: `/v1/fixed-assets/${id}/impair`,
    headers: authHeaders(ownerToken),
    payload: { impairment_date: date, amount_pkr: amount, reason: 'Compressor failure' },
  });
}

const getAsset = async (id: string) => {
  const res = await app.inject({
    method: 'GET',
    url: `/v1/fixed-assets/${id}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
};

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const jes = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'fixed_assets', sourceId: { in: createdAssetIds } },
      select: { id: true },
    });
    const jeIds = jes.map((j) => j.id);
    await prisma.depreciationSchedule.deleteMany({ where: { fixedAssetId: { in: createdAssetIds } } });
    await prisma.fixedAsset.updateMany({
      where: { id: { in: createdAssetIds } },
      data: { purchaseJournalEntryId: null, disposalJournalEntryId: null },
    });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.fixedAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the depreciation math respects a write-down', () => {
  const base = {
    method: 'SLM' as const,
    costPkr: 1200,
    residualValuePkr: 0,
    usefulLifeYears: 10,
    wdvRatePercent: null,
    depreciationStartDate: new Date(2030, 0, 5),
    periodYear: 2031,
    periodMonth: 1,
  };

  it('leaves an unimpaired schedule identical to the paisa', () => {
    const withField = computeMonthlyDepreciation({ ...base, openingNbvPkr: 1080, accumulatedImpairmentPkr: 0 });
    const without = computeMonthlyDepreciation({ ...base, openingNbvPkr: 1080 });
    expect(withField).toEqual(without);
    expect(withField.depreciationAmountPkr).toBeCloseTo(10, 2); // 1200 / 10 / 12
  });

  it('spreads the revised carrying amount over the remaining life after an impairment', () => {
    // 12 months elapsed of 120, so 108 remain. Carrying amount 540 after a
    // 540 write-down → 5 per month, not the original 10.
    const row = computeMonthlyDepreciation({
      ...base,
      openingNbvPkr: 540,
      accumulatedImpairmentPkr: 540,
    });
    expect(row.depreciationAmountPkr).toBeCloseTo(5, 2);
  });

  it('never charges the original amount against a written-down asset', () => {
    // The old formula would keep charging 10/month against a carrying amount
    // of 60, exhausting it in 6 months and then running past residual.
    const row = computeMonthlyDepreciation({
      ...base,
      openingNbvPkr: 60,
      accumulatedImpairmentPkr: 1020,
    });
    expect(row.depreciationAmountPkr).toBeLessThan(10);
    expect(row.closingNbvPkr).toBeGreaterThanOrEqual(0);
  });
});

describe('recording an impairment', () => {
  it('posts DR 6160 / CR 1370 and reduces the carrying amount', async () => {
    const id = await createAsset(`Impair Test Plant ${Date.now()}`);
    const before = await getAsset(id);
    expect(before.accumulated_impairment_pkr).toBe(0);

    const res = await impair(id, 400_000);
    expect(res.statusCode, res.body).toBe(201);
    const after = JSON.parse(res.body).data;

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: after.impairment_journal_entry_id },
    });
    expect(Number(lines.find((l) => l.accountCode === '6160')!.debitAmount)).toBeCloseTo(400_000, 2);
    expect(Number(lines.find((l) => l.accountCode === '1370')!.creditAmount)).toBeCloseTo(400_000, 2);
    // Nothing touches accumulated depreciation — a write-down is not allocation.
    expect(lines.some((l) => l.accountCode === before.accum_depr_account_code)).toBe(false);

    expect(after.accumulated_impairment_pkr).toBeCloseTo(400_000, 2);
    expect(after.net_book_value_pkr).toBeCloseTo(before.net_book_value_pkr - 400_000, 2);
    expect(after.status).toBe('IN_SERVICE');
  });

  it('refuses to impair beyond the carrying amount', async () => {
    const id = await createAsset(`Impair Cap Test ${Date.now()}`);
    const res = await impair(id, COST * 2);
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('amount_pkr');
  });

  it('refuses a zero or negative write-down', async () => {
    const id = await createAsset(`Impair Zero Test ${Date.now()}`);
    expect((await impair(id, 0)).statusCode).toBe(400);
    expect((await impair(id, -5)).statusCode).toBe(400);
  });

  it('writes the asset off when nothing is left to carry — P2-6 gets its first writer', async () => {
    const id = await createAsset(`Impair Writeoff Test ${Date.now()}`);
    const before = await getAsset(id);
    const res = await impair(id, before.net_book_value_pkr);
    expect(res.statusCode, res.body).toBe(201);
    const after = JSON.parse(res.body).data;
    expect(after.net_book_value_pkr).toBeCloseTo(0, 2);
    expect(after.status).toBe('WRITTEN_OFF');

    // And a written-off asset has nothing left to impair. 409, not 400 — the
    // request is well formed, the asset's state is what rejects it.
    expect((await impair(id, 1)).statusCode).toBe(409);
  });
});

describe('disposal clears the impairment too', () => {
  it('debits 1370 on disposal so nothing is stranded', async () => {
    const id = await createAsset(`Impair Disposal Test ${Date.now()}`);
    expect((await impair(id, 300_000)).statusCode).toBe(201);
    const impaired = await getAsset(id);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/fixed-assets/${id}/dispose`,
      headers: authHeaders(ownerToken),
      payload: { disposal_date: '2030-09-30', disposal_proceeds_pkr: 0 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const disposed = JSON.parse(res.body).data;

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: disposed.disposal_journal_entry_id },
    });
    expect(Number(lines.find((l) => l.accountCode === '1370')!.debitAmount)).toBeCloseTo(300_000, 2);

    // The loss on scrapping is the carrying amount AFTER impairment. Booking
    // the pre-impairment figure would recognise the write-down twice.
    const loss = lines.find((l) => l.accountCode === '6110');
    expect(Number(loss!.debitAmount)).toBeCloseTo(impaired.net_book_value_pkr, 2);

    const totalD = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalC = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalD).toBeCloseTo(totalC, 2);
  });
});
