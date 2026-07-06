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
  await prisma.payrollLineItem.deleteMany({
    where: { payrollRun: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.payrollRun.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { payrollJournalEntryId: null, paymentJournalEntryId: null, remittanceJournalEntryId: null },
  });
  await prisma.payrollRun.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.employee.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, journalEntry: { sourceTable: 'payroll_runs' } },
  });
  await prisma.journalEntry.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payroll_runs' },
  });
  await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

async function createSalaried(name: string, salary: number, eobiRegistered = true) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: authHeaders(managerToken),
    payload: {
      name,
      employee_type: 'SALARIED',
      designation: 'Manager',
      join_date: '2026-01-01',
      basic_salary_pkr: salary,
      eobi_registered: eobiRegistered,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id as string;
}

async function createDailyWage(name: string, wage: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: authHeaders(managerToken),
    payload: {
      name,
      employee_type: 'DAILY_WAGE',
      designation: 'Loader',
      join_date: '2026-01-01',
      daily_wage_pkr: wage,
      eobi_registered: true,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id as string;
}

describe('Phase 8B — Payroll', () => {
  it('creates a SALARIED employee', async () => {
    const id = await createSalaried(`Test-Mgr-${Date.now()}`, 45000);
    expect(id).toBeTruthy();
  });

  it('OPERATOR cannot create employees (MANAGER+)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Forbidden',
        employee_type: 'SALARIED',
        join_date: '2026-01-01',
        basic_salary_pkr: 25000,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects SALARIED without basic_salary_pkr', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(managerToken),
      payload: {
        name: 'Bad employee',
        employee_type: 'SALARIED',
        join_date: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates a DRAFT MONTHLY_SALARY run snapshotting active SALARIED employees', async () => {
    await cleanup();
    await createSalaried(`Manager-${Date.now()}`, 45000);
    await createSalaried(`Accountant-${Date.now()}`, 35000);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 4,
        period_from: '2026-04-01',
        period_to: '2026-04-30',
      },
    });
    expect(res.statusCode).toBe(201);
    const run = JSON.parse(res.body).data;
    expect(run.status).toBe('DRAFT');
    expect(run.run_number).toMatch(/^PAY-202604-\d{3}$/);
    expect(run.line_items.length).toBe(2);
    expect(run.total_gross_pkr).toBe(80000); // 45k + 35k
    // Both EOBI-registered: 2 * 375 = 750 employee, 2 * 1875 = 3750 employer
    expect(run.total_employer_eobi_pkr).toBe(3750);
    expect(run.total_net_payable_pkr).toBe(79250); // 80000 - 750
  });

  it('rejects duplicate run for same period+type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 4,
        period_from: '2026-04-01',
        period_to: '2026-04-30',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PAYROLL_RUN_DUPLICATE_PERIOD');
  });

  it('finalize SALARIED run posts JE-15 with correct lines', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/payroll-runs?status=DRAFT',
      headers: authHeaders(accountantToken),
    });
    const runId = JSON.parse(list.body).data[0].id;

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);
    const run = JSON.parse(fin.body).data;
    expect(run.status).toBe('FINALIZED');
    expect(run.payroll_journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: run.payroll_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PAYROLL');
    // SALARIED → 6010 expense, NOT 5030
    expect(je?.lines.find((l) => l.accountCode === '6010')).toBeTruthy();
    expect(je?.lines.find((l) => l.accountCode === '5030')).toBeUndefined();
    const totalD = je!.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalC = je!.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalD).toBeCloseTo(totalC);
  });

  it('cannot finalize already-finalized run', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/payroll-runs?status=FINALIZED',
      headers: authHeaders(accountantToken),
    });
    const runId = JSON.parse(list.body).data[0].id;
    const again = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('pay run posts JE-16: DR 2030 / CR 1020', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/payroll-runs?status=FINALIZED',
      headers: authHeaders(accountantToken),
    });
    const runId = JSON.parse(list.body).data[0].id;

    const pay = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/pay`,
      headers: authHeaders(managerToken),
      payload: { payment_date: '2026-05-01', from_asset_account_code: '1020' },
    });
    expect(pay.statusCode).toBe(200);
    const run = JSON.parse(pay.body).data;
    expect(run.status).toBe('PAID');
    expect(run.payment_journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: run.payment_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PAYROLL_PAYMENT');
    expect(je?.lines.find((l) => l.accountCode === '2030')?.debitAmount.toString()).toBe('79250');
    expect(je?.lines.find((l) => l.accountCode === '1020')?.creditAmount.toString()).toBe('79250');
  });

  it('remit posts JE-16B clearing EOBI liabilities', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/payroll-runs?status=PAID',
      headers: authHeaders(accountantToken),
    });
    const runId = JSON.parse(list.body).data[0].id;

    const rem = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/remit`,
      headers: authHeaders(ownerToken),
      payload: {
        remittance_date: '2026-05-15',
        from_asset_account_code: '1020',
        remit_employee_eobi_pkr: 750,
        remit_employer_eobi_pkr: 3750,
        remit_income_tax_pkr: 0,
      },
    });
    expect(rem.statusCode).toBe(201);
    const run = JSON.parse(rem.body).data;
    expect(run.remittance_journal_entry_id).toBeTruthy();
  });

  it('finalize DAILY_WAGES run posts JE-15B with 5030 / 5035', async () => {
    await cleanup();
    await createDailyWage(`Loader-${Date.now()}`, 1000);
    await createDailyWage(`Loader2-${Date.now()}`, 800);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'DAILY_WAGES',
        period_year: 2026,
        period_month: 5,
        period_from: '2026-05-01',
        period_to: '2026-05-31',
      },
    });
    expect(create.statusCode).toBe(201);
    const runId = JSON.parse(create.body).data.id;

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);
    const run = JSON.parse(fin.body).data;
    const je = await prisma.journalEntry.findUnique({
      where: { id: run.payroll_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.lines.find((l) => l.accountCode === '5030')).toBeTruthy();
    expect(je?.lines.find((l) => l.accountCode === '5035')).toBeTruthy();
    expect(je?.lines.find((l) => l.accountCode === '6010')).toBeUndefined();
  });

  it('rejects finalize when period locked', async () => {
    await cleanup();
    await createSalaried(`PL-Mgr-${Date.now()}`, 50000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 6,
        period_from: '2026-06-01',
        period_to: '2026-06-30',
      },
    });
    const runId = JSON.parse(create.body).data.id;

    const lock = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 6, reason: 'test' },
    });
    expect(lock.statusCode).toBe(201);

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(409);
    expect(JSON.parse(fin.body).error.code).toBe('PERIOD_LOCKED');

    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/6/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'cleanup' },
    });
  });

  it('OWNER-only KATCHI guard blocks MANAGER on payroll-run creation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(managerToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2027,
        period_month: 1,
        period_from: '2027-01-01',
        period_to: '2027-01-31',
        book_type: 'KATCHI',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('updates a payroll line and recomputes run totals', async () => {
    await cleanup();
    await createSalaried(`Mgr-${Date.now()}`, 50000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 7,
        period_from: '2026-07-01',
        period_to: '2026-07-31',
      },
    });
    const run = JSON.parse(create.body).data;
    const lineId = run.line_items[0].id;

    const upd = await app.inject({
      method: 'PATCH',
      url: `/v1/payroll-runs/${run.id}/lines/${lineId}`,
      headers: authHeaders(accountantToken),
      payload: { gross_pay_pkr: 60000, income_tax_pkr: 1000 },
    });
    expect(upd.statusCode).toBe(200);
    const updated = JSON.parse(upd.body).data;
    expect(updated.total_gross_pkr).toBe(60000);
    expect(updated.line_items[0].gross_pay_pkr).toBe(60000);
    expect(updated.line_items[0].income_tax_pkr).toBe(1000);
  });

  it('returns slip data for a payroll line', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
    });
    const run = JSON.parse(list.body).data[0];
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/payroll-runs/${run.id}`,
      headers: authHeaders(accountantToken),
    });
    const lineId = JSON.parse(detail.body).data.line_items[0].id;

    const slip = await app.inject({
      method: 'GET',
      url: `/v1/payroll-runs/${run.id}/lines/${lineId}/slip`,
      headers: authHeaders(accountantToken),
    });
    expect(slip.statusCode).toBe(200);
    const data = JSON.parse(slip.body).data;
    expect(data.runNumber).toBe(run.run_number);
    expect(data.netPay).toBeGreaterThan(0);
  });
});
