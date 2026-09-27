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

describe('C-30 / L-35 — assets owned at go-live join the register without a second entry', () => {
  // The opening-balance entry the register ties to: two plant assets at cost
  // 240,000 + 500,000, with 120,000 + 50,000 depreciated before go-live.
  const OB_ID = '00000000-0000-0000-0000-00000000c030';
  const openingAsset = {
    asset_name: 'Old compressor',
    asset_category: 'COLD_PLANT',
    purchase_date: '2027-07-01',
    purchase_cost_pkr: 240000,
    accumulated_depreciation_pkr: 120000,
    useful_life_years: 2,
    depreciation_method: 'SLM',
    depreciation_start_date: '2027-07-01',
  };
  const importAssets = (assets: Record<string, unknown>[]) => post('/v1/fixed-assets/opening', { assets });

  afterAll(async () => {
    await withGuardsDisabled(prisma, async () => {
      const scope = { facilityId: TEST_FACILITY_ID, sourceTable: 'opening_balances', sourceId: OB_ID };
      await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
      await prisma.journalEntry.deleteMany({ where: scope });
    });
  });

  it('refuses an opening asset while no opening-balance entry stands', async () => {
    const res = await importAssets([openingAsset]);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('brings an asset on at go-live with its accumulated depreciation and no journal entry', async () => {
    const { JournalEntryService } = await import('../../accounting/journal-entry.service');
    const { PeriodLockService } = await import('../../accounting/period-lock.service');
    await new JournalEntryService(prisma, new PeriodLockService(prisma)).post(
      TEST_FACILITY_ID,
      '00000000-0000-0000-0000-000000000010',
      {
        id: OB_ID,
        entryType: 'OPENING_BALANCE',
        bookType: 'PACCI',
        sourceTable: 'opening_balances',
        sourceId: OB_ID,
        entryDate: new Date('2028-06-30'),
        description: 'test opening balances',
        lines: [
          { accountCode: '1310', debitAmount: 740000, creditAmount: 0 },
          { accountCode: '1311', debitAmount: 0, creditAmount: 170000 },
          { accountCode: '3010', debitAmount: 0, creditAmount: 570000 },
        ],
      },
    );

    const res = await importAssets([openingAsset]);
    expect(res.statusCode, res.body).toBe(201);
    const [asset] = JSON.parse(res.body).data;
    expect(asset.is_opening_balance).toBe(true);
    expect(asset.status).toBe('IN_SERVICE');
    expect(asset.accumulated_depreciation_pkr).toBe(120000);
    expect(asset.purchase_journal_entry_id).toBeNull();
    expect(await prisma.journalEntry.count({ where: { sourceTable: 'fixed_assets', sourceId: asset.id } })).toBe(0);

    // Depreciation resumes with the first month after go-live, not from 2027.
    expect((await runDepreciation(2028, 7)).statusCode).toBe(201);
    expect(await months(asset.id)).toEqual(['2028-7']);
    expect(Number((await assetRow(asset.id)).accumulatedDepreciationPkr)).toBe(130000);
  });

  it('moves an asset already booked twice onto the opening register: purchase reversed, row kept', async () => {
    const asset = await createAsset({ purchase: '2028-01-10', cost: 500000 });
    const res = await post(`/v1/fixed-assets/${asset.id}/convert-to-opening`, {
      reason: 'already in the opening balances',
      opening_accumulated_depreciation_pkr: 50000,
      reversal_date: '2028-07-01',
    });
    expect(res.statusCode, res.body).toBe(200);
    const converted = JSON.parse(res.body).data;
    expect(converted.is_opening_balance).toBe(true);
    expect(converted.accumulated_depreciation_pkr).toBe(50000);
    const purchase = await prisma.journalEntry.findUniqueOrThrow({ where: { id: asset.purchase_journal_entry_id } });
    expect(purchase.reversedById).toBeTruthy();
  });

  it('ties the register to the opening entry per account', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/fixed-assets/opening-tie-out',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const tie = JSON.parse(res.body).data;
    expect(tie.opening_date).toBe('2028-06-30');
    const row = (code: string) => tie.accounts.find((a: any) => a.account_code === code);
    expect(row('1310')).toMatchObject({ kind: 'COST', ledger_pkr: 740000, register_pkr: 740000, difference_pkr: 0 });
    // The register's July depreciation is not opening depreciation.
    expect(row('1311')).toMatchObject({ kind: 'ACCUMULATED_DEPRECIATION', ledger_pkr: 170000, register_pkr: 170000 });
    expect(tie.is_reconciled).toBe(true);
  });

  // The opening-balance entry is official-book only: an informal-book asset bought
  // before go-live is not in it, so it was never booked twice.
  it('leaves an informal-book asset out of the go-live register', async () => {
    const res = await post('/v1/fixed-assets', {
      asset_name: 'KATCHI pump',
      asset_category: 'COLD_PLANT',
      purchase_date: '2028-01-15',
      purchase_cost_pkr: 1000,
      useful_life_years: 1,
      depreciation_method: 'SLM',
      book_type: 'KATCHI',
    });
    expect(res.statusCode, res.body).toBe(201);
    const katchi = JSON.parse(res.body).data;
    expect(katchi.allowed_actions).not.toContain('convert_to_opening');

    const convert = await post(`/v1/fixed-assets/${katchi.id}/convert-to-opening`, { reason: 'not really' });
    expect(convert.statusCode).toBe(409);

    const tie = await app.inject({ method: 'GET', url: '/v1/fixed-assets/opening-tie-out', headers: authHeaders(ownerToken) });
    const row = JSON.parse(tie.body).data.accounts.find((a: any) => a.account_code === '1310');
    expect(row.register_pkr).toBe(740000);
  });

  it('refuses an opening asset the opening entry does not carry', async () => {
    const res = await importAssets([{ ...openingAsset, asset_name: 'Phantom', purchase_cost_pkr: 10000, accumulated_depreciation_pkr: 0 }]);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
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
