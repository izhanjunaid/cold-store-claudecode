import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let operatorToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, cleanupInner);
}

async function cleanupInner() {
  await prisma.depreciationSchedule.deleteMany({
    where: { fixedAsset: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.fixedAsset.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { purchaseJournalEntryId: null, disposalJournalEntryId: null },
  });
  await prisma.fixedAsset.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, journalEntry: { sourceTable: 'fixed_assets' } },
  });
  await prisma.journalEntry.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: 'fixed_assets' },
  });
  await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  const owner = await loginAsRole(app, 'OWNER');
  const manager = await loginAsRole(app, 'MANAGER');
  const accountant = await loginAsRole(app, 'ACCOUNTANT');
  const operator = await loginAsRole(app, 'OPERATOR');
  ownerToken = owner.accessToken;
  managerToken = manager.accessToken;
  accountantToken = accountant.accessToken;
  operatorToken = operator.accessToken;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

async function createCompressor(): Promise<{ id: string; assetNumber: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/fixed-assets',
    headers: authHeaders(ownerToken),
    payload: {
      asset_name: 'Test Compressor',
      asset_category: 'COLD_PLANT',
      purchase_date: '2026-01-15',
      purchase_cost_pkr: 4500000,
      depreciation_method: 'WDV',
      wdv_rate_percent: 20,
    },
  });
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body).data;
  return { id: body.id, assetNumber: body.asset_number };
}

async function commission(id: string, startDate = '2026-02-01') {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/fixed-assets/${id}/commission`,
    headers: authHeaders(ownerToken),
    payload: { depreciation_start_date: startDate },
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
}

describe('Phase 8B — Fixed Assets', () => {
  it('creates a compressor with PURCHASED status and posts JE-12', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fixed-assets',
      headers: authHeaders(ownerToken),
      payload: {
        asset_name: 'JE-12 Test Asset',
        asset_category: 'COLD_PLANT',
        purchase_date: '2026-01-10',
        purchase_cost_pkr: 1000000,
        depreciation_method: 'WDV',
        wdv_rate_percent: 20,
      },
    });
    expect(res.statusCode).toBe(201);
    const data = JSON.parse(res.body).data;
    expect(data.status).toBe('PURCHASED');
    expect(data.asset_number).toMatch(/^FA-2026-\d{4}$/);
    expect(data.asset_account_code).toBe('1310');
    expect(data.depr_expense_account_code).toBe('5040');
    expect(data.purchase_journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: data.purchase_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('ASSET_PURCHASE');
    const totalD = je!.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalC = je!.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalD).toBeCloseTo(totalC);
    expect(totalD).toBe(1000000);
  });

  it('rejects SLM without useful_life_years', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fixed-assets',
      headers: authHeaders(ownerToken),
      payload: {
        asset_name: 'Bad SLM',
        asset_category: 'BUILDING',
        purchase_date: '2026-01-10',
        purchase_cost_pkr: 1000000,
        depreciation_method: 'SLM',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('OPERATOR cannot create assets (OWNER-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/fixed-assets',
      headers: authHeaders(operatorToken),
      payload: {
        asset_name: 'Forbidden',
        asset_category: 'BUILDING',
        purchase_date: '2026-01-10',
        purchase_cost_pkr: 1000000,
        depreciation_method: 'SLM',
        useful_life_years: 30,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('ACCOUNTANT can list and view assets', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/fixed-assets',
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('commission moves PURCHASED → IN_SERVICE', async () => {
    const { id } = await createCompressor();
    const data = await commission(id);
    expect(data.status).toBe('IN_SERVICE');
    expect(data.depreciation_start_date).toBe('2026-02-01');
  });

  it('cannot commission an asset already IN_SERVICE', async () => {
    const { id } = await createCompressor();
    await commission(id);
    const again = await app.inject({
      method: 'POST',
      url: `/v1/fixed-assets/${id}/commission`,
      headers: authHeaders(ownerToken),
      payload: { depreciation_start_date: '2026-03-01' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('runs monthly depreciation, posts JE-13 batch, increments accumulated', async () => {
    await cleanup();
    const { id } = await createCompressor();
    await commission(id, '2026-02-01');

    const run = await app.inject({
      method: 'POST',
      url: '/v1/depreciation/runs',
      headers: authHeaders(ownerToken),
      payload: { period_year: 2026, period_month: 2 },
    });
    expect(run.statusCode).toBe(201);
    const runBody = JSON.parse(run.body).data;
    expect(runBody.run_count).toBe(1);
    expect(runBody.total_depreciation_pkr).toBe(75000);

    const je = await prisma.journalEntry.findUnique({
      where: { id: runBody.entries[0].journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('DEPRECIATION');
    expect(je?.lines.find((l) => l.accountCode === '5040')?.debitAmount.toString()).toBe('75000');

    const updated = await prisma.fixedAsset.findUnique({ where: { id } });
    expect(Number(updated?.accumulatedDepreciationPkr)).toBe(75000);
  });

  it('re-running same period rejects with DEPRECIATION_ALREADY_POSTED', async () => {
    const repeat = await app.inject({
      method: 'POST',
      url: '/v1/depreciation/runs',
      headers: authHeaders(ownerToken),
      payload: { period_year: 2026, period_month: 2 },
    });
    expect(repeat.statusCode).toBe(409);
    expect(JSON.parse(repeat.body).error.code).toBe('DEPRECIATION_ALREADY_POSTED');
  });

  it('disposes asset above book value (gain) and posts JE-14 with 4230 line', async () => {
    await cleanup();
    const { id } = await createCompressor();
    await commission(id);
    // simulate prior depreciation
    await prisma.fixedAsset.update({
      where: { id },
      data: { accumulatedDepreciationPkr: 1000000 },
    });

    const dispose = await app.inject({
      method: 'POST',
      url: `/v1/fixed-assets/${id}/dispose`,
      headers: authHeaders(ownerToken),
      payload: {
        disposal_date: '2026-12-15',
        disposal_proceeds_pkr: 4000000, // NBV = 3.5M, gain = 500k
      },
    });
    expect(dispose.statusCode).toBe(201);
    const data = JSON.parse(dispose.body).data;
    expect(data.status).toBe('DISPOSED');

    const je = await prisma.journalEntry.findUnique({
      where: { id: data.disposal_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('ASSET_DISPOSAL');
    expect(je?.lines.find((l) => l.accountCode === '4230')?.creditAmount.toString()).toBe('500000');
  });

  it('disposes asset below book value (loss) and posts JE-14 with 6110 line', async () => {
    await cleanup();
    const { id } = await createCompressor();
    await commission(id);
    await prisma.fixedAsset.update({
      where: { id },
      data: { accumulatedDepreciationPkr: 1000000 },
    });

    const dispose = await app.inject({
      method: 'POST',
      url: `/v1/fixed-assets/${id}/dispose`,
      headers: authHeaders(ownerToken),
      payload: {
        disposal_date: '2026-12-15',
        disposal_proceeds_pkr: 3000000, // NBV = 3.5M, loss = 500k
      },
    });
    expect(dispose.statusCode).toBe(201);
    const data = JSON.parse(dispose.body).data;
    const je = await prisma.journalEntry.findUnique({
      where: { id: data.disposal_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.lines.find((l) => l.accountCode === '6110')?.debitAmount.toString()).toBe('500000');
  });

  it('rejects depreciation run for locked period with PERIOD_LOCKED', async () => {
    await cleanup();
    const { id } = await createCompressor();
    await commission(id, '2026-03-01');

    const lock = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 3, reason: 'test' },
    });
    expect(lock.statusCode).toBe(201);

    const run = await app.inject({
      method: 'POST',
      url: '/v1/depreciation/runs',
      headers: authHeaders(ownerToken),
      payload: { period_year: 2026, period_month: 3 },
    });
    expect(run.statusCode).toBe(409);
    expect(JSON.parse(run.body).error.code).toBe('PERIOD_LOCKED');

    // Cleanup the lock for subsequent tests
    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/3/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'cleanup' },
    });
  });

  it('GET depreciation runs returns aggregated periods', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/depreciation/runs',
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('asset numbering increments per year', async () => {
    await cleanup();
    const a1 = await createCompressor();
    const a2 = await createCompressor();
    expect(a1.assetNumber).toMatch(/^FA-2026-/);
    expect(a2.assetNumber).toMatch(/^FA-2026-/);
    const seq1 = parseInt(a1.assetNumber.split('-')[2]!, 10);
    const seq2 = parseInt(a2.assetNumber.split('-')[2]!, 10);
    expect(seq2).toBe(seq1 + 1);
  });
});
