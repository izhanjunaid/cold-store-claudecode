/**
 * docs/25 Stream C-a — fixed-asset findings (C-29, C-31, C-32, C-33, C-34, C-38, L-21).
 * Every asset here is dated 2029 so the depreciation runs cannot reach another
 * suite's; the file clears the facility's register before and after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.depreciationSchedule.deleteMany({ where: { fixedAsset: { facilityId: TEST_FACILITY_ID } } });
    await prisma.fixedAsset.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { purchaseJournalEntryId: null, disposalJournalEntryId: null },
    });
    await prisma.fixedAsset.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    const scope = { facilityId: TEST_FACILITY_ID, sourceTable: 'fixed_assets' };
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

const post = (url: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: authHeaders(ownerToken), payload });

/** SLM, one-year life, cost 120,000: exactly 10,000 a month. */
async function createAsset(opts: { purchase?: string; category?: string; cost?: number } = {}) {
  const res = await post('/v1/fixed-assets', {
    asset_name: `CA asset ${Date.now()}`,
    asset_category: opts.category ?? 'COLD_PLANT',
    purchase_date: opts.purchase ?? '2029-01-01',
    purchase_cost_pkr: opts.cost ?? 120000,
    useful_life_years: 1,
    depreciation_method: 'SLM',
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).data as any;
}

async function inService(start = '2029-01-01', purchase = start) {
  const asset = await createAsset({ purchase });
  const res = await post(`/v1/fixed-assets/${asset.id}/commission`, { depreciation_start_date: start });
  expect(res.statusCode, res.body).toBe(200);
  return asset;
}

const runDepreciation = (year: number, month: number) =>
  post('/v1/depreciation/runs', { period_year: year, period_month: month });

const schedulesOf = (assetId: string) =>
  prisma.depreciationSchedule.findMany({
    where: { fixedAssetId: assetId, status: 'POSTED' },
    orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }],
  });
const months = async (assetId: string) => (await schedulesOf(assetId)).map((s) => `${s.periodYear}-${s.periodMonth}`);
const assetRow = (id: string) => prisma.fixedAsset.findUniqueOrThrow({ where: { id } });

describe('C-29 — depreciation catches each asset up; nothing can deadlock', () => {
  it('an asset commissioned into a month already run is caught up by the next run', async () => {
    const b = await inService('2029-01-01');
    for (const m of [1, 2, 3]) expect((await runDepreciation(2029, m)).statusCode).toBe(201);

    // A enters service in March, after March has been run.
    const a = await inService('2029-03-05', '2029-03-01');
    const april = await runDepreciation(2029, 4);
    expect(april.statusCode, april.body).toBe(201);

    expect(await months(a.id)).toEqual(['2029-3', '2029-4']);
    expect(await months(b.id)).toEqual(['2029-1', '2029-2', '2029-3', '2029-4']);
    expect(Number((await assetRow(a.id)).accumulatedDepreciationPkr)).toBe(20000);
  });

  it('commission refuses a start date before the asset was bought', async () => {
    const asset = await createAsset({ purchase: '2029-05-10' });
    const res = await post(`/v1/fixed-assets/${asset.id}/commission`, { depreciation_start_date: '2029-05-01' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('C-31 / C-32 / C-38 — disposal', () => {
  it('two concurrent disposals: one wins and one JE-14 is posted', async () => {
    const asset = await createAsset({ purchase: '2029-02-01' });
    const body = { disposal_date: '2029-02-10', disposal_proceeds_pkr: 100000 };
    const [x, y] = await Promise.all([
      post(`/v1/fixed-assets/${asset.id}/dispose`, body),
      post(`/v1/fixed-assets/${asset.id}/dispose`, body),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);
    const disposals = await prisma.journalEntry.findMany({
      where: { sourceTable: 'fixed_assets', sourceId: asset.id, entryType: 'ASSET_DISPOSAL' },
    });
    expect(disposals).toHaveLength(1);
  });

  it('depreciates the asset up to the disposal date first, and keeps proceeds of 0 as 0', async () => {
    const asset = await inService('2029-05-01');
    const res = await post(`/v1/fixed-assets/${asset.id}/dispose`, {
      disposal_date: '2029-08-10',
      disposal_proceeds_pkr: 0,
    });
    expect(res.statusCode, res.body).toBe(201);
    const disposed = JSON.parse(res.body).data;
    expect(disposed.disposal_proceeds_pkr).toBe(0);

    expect(await months(asset.id)).toEqual(['2029-5', '2029-6', '2029-7']);
    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: disposed.disposal_journal_entry_id } });
    expect(Number(lines.find((l) => l.accountCode === '1311')!.debitAmount)).toBe(30000);
    expect(Number(lines.find((l) => l.accountCode === '6110')!.debitAmount)).toBe(90000);
  });

  it('refuses a disposal dated before depreciation already posted', async () => {
    const asset = await inService('2029-06-01');
    expect((await runDepreciation(2029, 7)).statusCode).toBe(201);
    const res = await post(`/v1/fixed-assets/${asset.id}/dispose`, {
      disposal_date: '2029-06-20',
      disposal_proceeds_pkr: 0,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect((await assetRow(asset.id)).status).toBe('IN_SERVICE');
  });

  it('a written-off asset can still be disposed of', async () => {
    const asset = await createAsset({ purchase: '2029-03-01' });
    const impair = await post(`/v1/fixed-assets/${asset.id}/impair`, {
      impairment_date: '2029-03-05',
      amount_pkr: 120000,
      reason: 'flood',
    });
    expect(impair.statusCode, impair.body).toBe(201);
    expect(JSON.parse(impair.body).data.status).toBe('WRITTEN_OFF');

    const res = await post(`/v1/fixed-assets/${asset.id}/dispose`, { disposal_date: '2029-03-10', disposal_proceeds_pkr: 0 });
    expect(res.statusCode, res.body).toBe(201);
    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: JSON.parse(res.body).data.disposal_journal_entry_id },
    });
    expect(Number(lines.find((l) => l.accountCode === '1370')!.debitAmount)).toBe(120000);
  });
});

describe('C-33 — every asset posting has a correction', () => {
  it('voids an asset bought in error: reverses JE-12 and keeps it out of depreciation', async () => {
    const asset = await inService('2029-09-01');
    const res = await post(`/v1/fixed-assets/${asset.id}/void`, { reason: 'entered twice', void_date: '2029-09-02' });
    expect(res.statusCode, res.body).toBe(200);
    const voided = JSON.parse(res.body).data;
    expect(voided.voided_at).toBeTruthy();
    expect(voided.void_reason).toBe('entered twice');

    const purchase = await prisma.journalEntry.findUniqueOrThrow({ where: { id: asset.purchase_journal_entry_id } });
    expect(purchase.reversedById).toBeTruthy();

    await runDepreciation(2029, 9);
    expect(await months(asset.id)).toEqual([]);
  });

  it('refuses to void an asset that has depreciated', async () => {
    const asset = await inService('2029-10-01');
    expect((await runDepreciation(2029, 10)).statusCode).toBe(201);
    const res = await post(`/v1/fixed-assets/${asset.id}/void`, { reason: 'too late' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ASSET_NOT_REVERSIBLE');
  });

  it('reverses the latest depreciation month, and the next run posts it again', async () => {
    const asset = await inService('2029-11-01');
    expect((await runDepreciation(2029, 12)).statusCode).toBe(201);
    expect(await months(asset.id)).toEqual(['2029-11', '2029-12']);

    const res = await post(`/v1/fixed-assets/${asset.id}/reverse-depreciation`, { reason: 'wrong rate' });
    expect(res.statusCode, res.body).toBe(200);
    expect(await months(asset.id)).toEqual(['2029-11']);
    expect(Number((await assetRow(asset.id)).accumulatedDepreciationPkr)).toBe(10000);

    expect((await runDepreciation(2029, 12)).statusCode).toBe(201);
    expect(await months(asset.id)).toEqual(['2029-11', '2029-12']);
    expect(Number((await assetRow(asset.id)).accumulatedDepreciationPkr)).toBe(20000);
  });

  it('reverses the latest impairment, and a written-off asset returns to service', async () => {
    const asset = await createAsset({ purchase: '2029-04-01' });
    expect(
      (await post(`/v1/fixed-assets/${asset.id}/impair`, { impairment_date: '2029-04-02', amount_pkr: 120000, reason: 'x' }))
        .statusCode,
    ).toBe(201);

    const res = await post(`/v1/fixed-assets/${asset.id}/reverse-impairment`, { reason: 'the compressor was repaired' });
    expect(res.statusCode, res.body).toBe(200);
    const after = JSON.parse(res.body).data;
    expect(after.accumulated_impairment_pkr).toBe(0);
    expect(after.status).toBe('PURCHASED');
    const impairments = await prisma.journalEntry.findMany({
      where: { sourceTable: 'fixed_assets', sourceId: asset.id, entryType: 'IMPAIRMENT' },
    });
    expect(impairments).toHaveLength(1);
    expect(impairments[0]!.reversedById).toBeTruthy();
  });
});

describe('C-34 / L-21 — category accounts come from the registry', () => {
  it('computer hardware depreciates to 6170; other equipment has its own three accounts', async () => {
    const computer = await createAsset({ category: 'COMPUTER', purchase: '2029-01-15' });
    expect(computer.depr_expense_account_code).toBe('6170');
    const other = await createAsset({ category: 'OTHER', purchase: '2029-01-15' });
    expect(other.asset_account_code).toBe('1380');
    expect(other.accum_depr_account_code).toBe('1381');
    expect(other.depr_expense_account_code).toBe('6180');
  });

  it('an impairment is posted as an IMPAIRMENT entry', async () => {
    const asset = await createAsset({ purchase: '2029-02-01' });
    const res = await post(`/v1/fixed-assets/${asset.id}/impair`, {
      impairment_date: '2029-02-02',
      amount_pkr: 1000,
      reason: 'dent',
    });
    expect(res.statusCode, res.body).toBe(201);
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: JSON.parse(res.body).data.impairment_journal_entry_id },
    });
    expect(je.entryType).toBe('IMPAIRMENT');
  });
});
