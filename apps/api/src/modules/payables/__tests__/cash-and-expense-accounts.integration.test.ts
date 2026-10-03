/**
 * docs/25 C-05 / C-06 / C-07 — "which account may this money come from / go to" is
 * read off the chart, server-side, never from a code list or a browser-only rule.
 *
 * - (The expense-account rule, C-05, is proven on bill lines in payables.integration.test.ts.)
 * - Money leaves from (or arrives in) an active DETAIL cash equivalent. An owner's
 *   second bank account works; cheques in hand (1025) never does.
 * - An asset may also be funded by a non-current liability (an equipment loan).
 *
 * Everything here is dated 2037 and cleaned up by id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();
const OWN_BANK = '1047';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;

const assetIds: string[] = [];
const runIds: string[] = [];
const employeeIds: string[] = [];

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  await prisma.chartOfAccounts.upsert({
    where: { facilityId_accountCode: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } },
    update: {},
    create: {
      facilityId: TEST_FACILITY_ID,
      accountCode: OWN_BANK,
      accountName: 'Second bank — C-06 test',
      accountClass: 'ASSET',
      accountType: 'DETAIL',
      parentAccountCode: '1000',
      normalBalance: 'DEBIT',
      isCashEquivalent: true,
    },
  });
}, 30_000);

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const sources = [
      { sourceTable: 'fixed_assets', sourceId: { in: assetIds } },
      { sourceTable: 'payroll_runs', sourceId: { in: runIds } },
    ];
    const scope = { facilityId: TEST_FACILITY_ID, OR: sources };
    await prisma.depreciationSchedule.deleteMany({ where: { fixedAssetId: { in: assetIds } } });
    await prisma.fixedAsset.updateMany({
      where: { id: { in: assetIds } },
      data: { purchaseJournalEntryId: null, disposalJournalEntryId: null },
    });
    await prisma.fixedAsset.deleteMany({ where: { id: { in: assetIds } } });
    await prisma.payrollLineItem.deleteMany({ where: { payrollRunId: { in: runIds } } });
    await prisma.payrollRun.updateMany({
      where: { id: { in: runIds } },
      data: { payrollJournalEntryId: null, paymentJournalEntryId: null, remittanceJournalEntryId: null },
    });
    await prisma.payrollRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

const post = (url: string, token: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url, headers: authHeaders(token), payload });

const errorOf = (res: { body: string }) => JSON.parse(res.body).error as { code: string; message: string };

describe('C-06 / C-07 — money moves through cash equivalents only', () => {
  it('salaries are never paid out of cheques in hand; an owner-added bank works', async () => {
    const emp = await post('/v1/employees', ownerToken, {
      name: `C06-Sal-${Date.now()}`,
      employee_type: 'SALARIED',
      basic_salary_pkr: 30000,
      join_date: '2036-01-01',
      eobi_registered: false,
    });
    expect(emp.statusCode, emp.body).toBe(201);
    employeeIds.push(JSON.parse(emp.body).data.id);

    const draft = await post('/v1/payroll-runs', accountantToken, {
      payroll_type: 'MONTHLY_SALARY',
      period_year: 2037,
      period_month: 1,
      period_from: '2037-01-01',
      period_to: '2037-01-31',
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const run = JSON.parse(draft.body).data;
    runIds.push(run.id);
    expect((await post(`/v1/payroll-runs/${run.id}/finalize`, managerToken, {})).statusCode).toBe(200);

    const bad = await post(`/v1/payroll-runs/${run.id}/pay`, managerToken, {
      payment_date: '2037-02-01',
      from_asset_account_code: '1025',
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(errorOf(bad).code).toBe('NOT_A_CASH_ACCOUNT');

    const ok = await post(`/v1/payroll-runs/${run.id}/pay`, managerToken, {
      payment_date: '2037-02-01',
      from_asset_account_code: OWN_BANK,
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('an asset is funded by cash or a non-current liability, never a current liability or cheques in hand', async () => {
    const asset = (paidFrom: string) =>
      post('/v1/fixed-assets', ownerToken, {
        asset_name: `C06 asset ${paidFrom}`,
        asset_category: 'COMPUTER',
        purchase_date: '2037-01-15',
        purchase_cost_pkr: 60000,
        useful_life_years: 3,
        depreciation_method: 'SLM',
        paid_from_account_code: paidFrom,
      });

    for (const code of ['1025', '2050', '4010']) {
      const res = await asset(code);
      if (res.statusCode === 201) assetIds.push(JSON.parse(res.body).data.id);
      expect(res.statusCode, `funded from ${code}`).toBe(400);
      expect(errorOf(res).message).toContain(code);
    }
    for (const code of [OWN_BANK, '2110']) {
      const res = await asset(code);
      expect(res.statusCode, res.body).toBe(201);
      assetIds.push(JSON.parse(res.body).data.id);
    }
  });

  it('disposal proceeds land in a cash equivalent', async () => {
    const created = await post('/v1/fixed-assets', ownerToken, {
      asset_name: 'C06 disposal asset',
      asset_category: 'COMPUTER',
      purchase_date: '2037-01-15',
      purchase_cost_pkr: 60000,
      useful_life_years: 3,
      depreciation_method: 'SLM',
    });
    expect(created.statusCode, created.body).toBe(201);
    const asset = JSON.parse(created.body).data;
    assetIds.push(asset.id);

    const bad = await post(`/v1/fixed-assets/${asset.id}/dispose`, ownerToken, {
      disposal_date: '2037-01-20',
      disposal_proceeds_pkr: 50000,
      proceeds_account_code: '1025',
    });
    expect(bad.statusCode, bad.body).toBe(422);
    expect(errorOf(bad).code).toBe('NOT_A_CASH_ACCOUNT');

    const ok = await post(`/v1/fixed-assets/${asset.id}/dispose`, ownerToken, {
      disposal_date: '2037-01-20',
      disposal_proceeds_pkr: 50000,
      proceeds_account_code: OWN_BANK,
    });
    expect(ok.statusCode, ok.body).toBe(201);
  });
});
