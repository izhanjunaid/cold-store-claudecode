/**
 * docs/25 Stream C-a — payroll and employee-advance findings. Every test isolates
 * itself in its own 2028/2029 period with its own employees, and deactivates them
 * afterwards, so a draft only ever snapshots the employees the test created.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.employeeAdvance.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { issueJournalEntryId: null, writeOffJournalEntryId: null },
    });
    await prisma.employeeAdvance.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.payrollLineItem.deleteMany({ where: { payrollRun: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payrollRun.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { payrollJournalEntryId: null, paymentJournalEntryId: null, remittanceJournalEntryId: null },
    });
    await prisma.payrollRun.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.employee.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    const scope = {
      facilityId: TEST_FACILITY_ID,
      OR: [{ sourceTable: 'payroll_runs' }, { sourceTable: 'employee_advances' }],
    };
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
}, 30_000);

// Keep every later draft to the employees its own test creates.
afterEach(async () => {
  await prisma.employee.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { isActive: false } });
});

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function createEmployee(payload: Record<string, unknown>) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: authHeaders(ownerToken),
    payload: { join_date: '2026-01-01', eobi_registered: true, ...payload },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).data as { id: string; cost_account_code?: string };
}

const salaried = (salary = 50000, extra: Record<string, unknown> = {}) =>
  createEmployee({ name: `CA-Sal-${uniq()}`, employee_type: 'SALARIED', basic_salary_pkr: salary, ...extra });
const dailyWage = (wage = 1000, extra: Record<string, unknown> = {}) =>
  createEmployee({ name: `CA-Day-${uniq()}`, employee_type: 'DAILY_WAGE', daily_wage_pkr: wage, ...extra });

async function issueAdvance(employeeId: string, principal: number, installment: number, date = '2027-12-10') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employee-advances/issue',
    headers: authHeaders(ownerToken),
    payload: {
      employee_id: employeeId,
      issue_date: date,
      principal_pkr: principal,
      monthly_installment_pkr: installment,
      payment_method: 'CASH',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).data as { id: string };
}

async function draft(year: number, month: number, type: 'MONTHLY_SALARY' | 'DAILY_WAGES' = 'MONTHLY_SALARY') {
  const mm = String(month).padStart(2, '0');
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/payroll-runs',
    headers: authHeaders(accountantToken),
    payload: {
      payroll_type: type,
      period_year: year,
      period_month: month,
      period_from: `${year}-${mm}-01`,
      period_to: `${year}-${mm}-${last}`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body).data;
}

const finalize = (runId: string) =>
  app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/finalize`, headers: authHeaders(managerToken), payload: {} });
const pay = (runId: string, date: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/payroll-runs/${runId}/pay`,
    headers: authHeaders(managerToken),
    payload: { payment_date: date },
  });

const entriesOf = (runId: string, entryType: 'PAYROLL' | 'PAYROLL_PAYMENT' | 'REVERSAL') =>
  prisma.journalEntry.findMany({ where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payroll_runs', sourceId: runId, entryType } });

describe('C-13 — every payroll transition locks the run first', () => {
  it('two concurrent finalizes: exactly one wins and exactly one JE-15 is posted', async () => {
    await salaried(40000);
    const run = await draft(2028, 1);

    const [a, b] = await Promise.all([finalize(run.id), finalize(run.id)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = [a, b].find((r) => r.statusCode === 409)!;
    expect(JSON.parse(loser.body).error.code).toBe('PAYROLL_RUN_INVALID_STATUS');
    expect(await entriesOf(run.id, 'PAYROLL')).toHaveLength(1);
  });

  it('two concurrent payments: exactly one wins and exactly one JE-16 is posted', async () => {
    await salaried(40000);
    const run = await draft(2028, 2);
    expect((await finalize(run.id)).statusCode).toBe(200);

    const [a, b] = await Promise.all([pay(run.id, '2028-03-01'), pay(run.id, '2028-03-01')]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const loser = [a, b].find((r) => r.statusCode === 409)!;
    expect(JSON.parse(loser.body).error.code).toBe('PAYROLL_RUN_INVALID_STATUS');
    expect(await entriesOf(run.id, 'PAYROLL_PAYMENT')).toHaveLength(1);
  });
});

describe('C-14 — an advance cannot be recovered past its balance across two drafts', () => {
  it('the second of two drafts pre-filled from the same balance is refused at finalize', async () => {
    const emp = await salaried(50000);
    const advance = await issueAdvance(emp.id, 5000, 3000);

    // Both drafts pre-fill 3000 from the same 5000 balance.
    const jan = await draft(2028, 3);
    const feb = await draft(2028, 4);
    const lineOf = (run: any) => run.line_items.find((l: any) => l.employee_id === emp.id);
    expect(lineOf(jan).advance_recovery_pkr).toBe(3000);
    expect(lineOf(feb).advance_recovery_pkr).toBe(3000);

    expect((await finalize(jan.id)).statusCode).toBe(200);
    const afterJan = await prisma.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(Number(afterJan.balanceOutstandingPkr)).toBe(2000);

    // 3000 against a live balance of 2000.
    const res = await finalize(feb.id);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('EMPLOYEE_ADVANCE_OVER_RECOVERY');

    expect(await entriesOf(feb.id, 'PAYROLL')).toHaveLength(0);
    const after = await prisma.employeeAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(Number(after.balanceOutstandingPkr)).toBe(2000);
    expect(after.status).toBe('ACTIVE');
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: feb.id } })).status).toBe('DRAFT');
  });
});

const patchLine = (runId: string, lineId: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/payroll-runs/${runId}/lines/${lineId}`,
    headers: authHeaders(accountantToken),
    payload,
  });

/** Run `fn` with the facility's payroll settings overridden, restoring them afterwards. */
async function withPayrollSettings(payroll: Record<string, number>, fn: () => Promise<void>) {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } });
  const original = facility.settings;
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: { ...(original as object), payroll } },
  });
  try {
    await fn();
  } finally {
    await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: original as object } });
  }
}

describe('C-18 / C-19 — daily-wage gross is days x wage; statutory figures come from settings', () => {
  it('draft pre-fills standard working days and the EOBI amounts from facility settings', async () => {
    await withPayrollSettings(
      { eobi_employee_monthly_pkr: 400, eobi_employer_monthly_pkr: 2000, standard_working_days: 22 },
      async () => {
        const emp = await dailyWage(1000);
        const run = await draft(2029, 1, 'DAILY_WAGES');
        const line = run.line_items.find((l: any) => l.employee_id === emp.id);
        expect(line.days_worked).toBe(22);
        expect(line.gross_pay_pkr).toBe(22000);
        expect(line.eobi_employee_pkr).toBe(400);
        expect(line.eobi_employer_pkr).toBe(2000);
        expect(line.net_pay_pkr).toBe(21600);
      },
    );
  });

  it('editing days worked recomputes gross on the server', async () => {
    const emp = await dailyWage(1000);
    const run = await draft(2029, 2, 'DAILY_WAGES');
    const line = run.line_items.find((l: any) => l.employee_id === emp.id);

    const res = await patchLine(run.id, line.id, { days_worked: 20 });
    expect(res.statusCode, res.body).toBe(200);
    const updated = JSON.parse(res.body).data.line_items.find((l: any) => l.id === line.id);
    expect(updated.days_worked).toBe(20);
    expect(updated.gross_pay_pkr).toBe(20000);
    expect(updated.net_pay_pkr).toBe(20000 - updated.eobi_employee_pkr);
    expect(JSON.parse(res.body).data.total_gross_pkr).toBe(20000);
  });

  it('a daily-wage gross cannot be typed over', async () => {
    const emp = await dailyWage(1000);
    const run = await draft(2029, 3, 'DAILY_WAGES');
    const line = run.line_items.find((l: any) => l.employee_id === emp.id);
    const res = await patchLine(run.id, line.id, { gross_pay_pkr: 99999 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it("an advance is capped at one month's pay using the facility's standard working days", async () => {
    await withPayrollSettings(
      { eobi_employee_monthly_pkr: 375, eobi_employer_monthly_pkr: 1875, standard_working_days: 22 },
      async () => {
        const emp = await dailyWage(1000);
        const res = await app.inject({
          method: 'POST',
          url: '/v1/employee-advances/issue',
          headers: authHeaders(ownerToken),
          payload: {
            employee_id: emp.id,
            issue_date: '2027-12-10',
            principal_pkr: 25000, // within 26 days' wage, above 22 days'
            monthly_installment_pkr: 5000,
            payment_method: 'CASH',
          },
        });
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).error.code).toBe('EMPLOYEE_ADVANCE_EXCEEDS_CAP');
      },
    );
  });
});

describe('C-16 — pay is expensed by what the employee does, not how they are paid', () => {
  it('stamps the default cost account by type and refuses one that is not a payroll cost account', async () => {
    const office = await salaried(40000);
    expect(office.cost_account_code).toBe('6010');
    const loader = await dailyWage(900);
    expect(loader.cost_account_code).toBe('5030');

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(ownerToken),
      payload: {
        name: `CA-Bad-${uniq()}`,
        employee_type: 'SALARIED',
        join_date: '2026-01-01',
        basic_salary_pkr: 30000,
        cost_account_code: '4010',
      },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('JE-15 debits each employee group to its own cost account and pairs employer EOBI with it', async () => {
    // A salaried plant operator is direct labour; the office clerk is overhead.
    await salaried(60000, { cost_account_code: '5030' });
    await salaried(40000);
    const run = await draft(2029, 4);
    const fin = await finalize(run.id);
    expect(fin.statusCode, fin.body).toBe(200);

    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: JSON.parse(fin.body).data.payroll_journal_entry_id },
      include: { lines: true },
    });
    const debit = (code: string) =>
      je.lines.filter((l) => l.accountCode === code).reduce((s, l) => s + Number(l.debitAmount), 0);
    expect(debit('5030')).toBe(60000);
    expect(debit('5035')).toBe(1875);
    expect(debit('6010')).toBe(40000);
    expect(debit('6015')).toBe(1875);
  });
});

describe('C-17 / C-24 — other deductions are gone; a negative net is refused where it is typed', () => {
  it('no longer reports or accepts other deductions', async () => {
    const emp = await salaried(40000);
    const run = await draft(2029, 5);
    const line = run.line_items.find((l: any) => l.employee_id === emp.id);
    expect(line).not.toHaveProperty('other_deductions_pkr');

    const res = await patchLine(run.id, line.id, { other_deductions_pkr: 2500 });
    expect(res.statusCode).toBe(200);
    const row = await prisma.payrollLineItem.findUniqueOrThrow({ where: { id: line.id } });
    expect(Number(row.otherDeductionsPkr)).toBe(0);
    expect(Number(row.netPayPkr)).toBe(40000 - 375);
  });

  it('refuses a line whose deductions exceed its gross', async () => {
    const emp = await salaried(40000);
    const run = await draft(2029, 6);
    const line = run.line_items.find((l: any) => l.employee_id === emp.id);
    const res = await patchLine(run.id, line.id, { income_tax_pkr: 45000 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('the slip says which runs it is not final for', async () => {
    const emp = await salaried(40000);
    const run = await draft(2029, 7);
    const line = run.line_items.find((l: any) => l.employee_id === emp.id);
    const slip = await app.inject({
      method: 'GET',
      url: `/v1/payroll-runs/${run.id}/lines/${line.id}/slip`,
      headers: authHeaders(accountantToken),
    });
    expect(slip.statusCode).toBe(200);
    expect(JSON.parse(slip.body).data.status).toBe('DRAFT');
  });
});

describe('C-21 — an owner is not an employee', () => {
  const MARK = 'CATEST';
  afterAll(async () => {
    const partners = await prisma.partner.findMany({
      where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
    });
    await prisma.partnerProfitShare.deleteMany({ where: { partnerId: { in: partners.map((p) => p.id) } } });
    await prisma.partner.deleteMany({ where: { id: { in: partners.map((p) => p.id) } } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountName: { startsWith: MARK } },
    });
  });

  it("refuses an employee whose CNIC is an active partner's", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/partners',
      headers: authHeaders(ownerToken),
      payload: { name: `${MARK} Owner`, admitted_on: '2026-01-01' },
    });
    expect(res.statusCode, res.body).toBe(201);
    await prisma.partner.update({
      where: { id: JSON.parse(res.body).data.id },
      data: { cnic: '35202-1234567-1' },
    });

    const create = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(ownerToken),
      payload: {
        name: `CA-Owner-${uniq()}`,
        employee_type: 'SALARIED',
        join_date: '2026-01-01',
        basic_salary_pkr: 100000,
        cnic: '3520212345671', // same person, typed without dashes
      },
    });
    expect(create.statusCode).toBe(400);
    expect(JSON.parse(create.body).error.code).toBe('VALIDATION_ERROR');

    const emp = await salaried(30000);
    const update = await app.inject({
      method: 'PATCH',
      url: `/v1/employees/${emp.id}`,
      headers: authHeaders(ownerToken),
      payload: { cnic: '35202-1234567-1' },
    });
    expect(update.statusCode).toBe(400);
  });
});

describe('C-22 — the ledger ties to the payroll register', () => {
  it('2030 Salaries Payable equals the net pay of finalised, unpaid runs', async () => {
    await salaried(30000);
    const unpaid = await draft(2029, 8);
    expect((await finalize(unpaid.id)).statusCode).toBe(200);
    await salaried(20000);
    const paid = await draft(2029, 9);
    expect((await finalize(paid.id)).statusCode).toBe(200);
    expect((await pay(paid.id, '2029-10-01')).statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/payroll-runs/${unpaid.id}`,
      headers: authHeaders(accountantToken),
    });
    const tie = JSON.parse(res.body).data.salaries_payable;
    expect(tie.is_reconciled).toBe(true);

    // Independently of the API: the ledger balance against the register.
    const lines = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '2030',
        journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' },
      },
      _sum: { creditAmount: true, debitAmount: true },
    });
    const gl = Number(lines._sum.creditAmount ?? 0) - Number(lines._sum.debitAmount ?? 0);
    const runs = await prisma.payrollRun.findMany({
      where: { facilityId: TEST_FACILITY_ID, status: 'FINALIZED', bookType: 'PACCI' },
      include: { lineItems: true },
    });
    const register = runs.flatMap((r) => r.lineItems).reduce((s, l) => s + Number(l.netPayPkr), 0);
    expect(gl).toBeCloseTo(register, 2);
    expect(tie.gl_salaries_payable_pkr).toBeCloseTo(gl, 2);
    expect(tie.unpaid_net_pay_pkr).toBeCloseTo(register, 2);
  });
});

describe('C-27 — an employee advance written off is a staff cost, not a customer bad debt', () => {
  it('debits Staff Welfare & Benefits', async () => {
    const emp = await salaried(40000);
    const advance = await issueAdvance(emp.id, 8000, 2000);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${advance.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'left without notice', write_off_date: '2027-12-20' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: JSON.parse(res.body).data.write_off_journal_entry_id },
      include: { lines: true },
    });
    expect(Number(je.lines.find((l) => l.accountCode === '6190')?.debitAmount)).toBe(8000);
    expect(je.lines.find((l) => l.accountCode === '6080')).toBeUndefined();
  });
});

describe('invariant — 1230 Advances to Employees equals the advance register', () => {
  it('holds after issues, payroll recoveries and write-offs', async () => {
    const a = await salaried(50000);
    const b = await salaried(50000);
    await issueAdvance(a.id, 6000, 2500, '2029-10-01');
    const bAdvance = await issueAdvance(b.id, 4000, 1000, '2029-10-01');
    const run = await draft(2029, 10);
    expect((await finalize(run.id)).statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${bAdvance.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'forgiven', write_off_date: '2029-11-05' },
    });

    const lines = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '1230',
        journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const gl = Number(lines._sum.debitAmount ?? 0) - Number(lines._sum.creditAmount ?? 0);
    const register = await prisma.employeeAdvance.aggregate({
      where: { facilityId: TEST_FACILITY_ID, bookType: 'PACCI' },
      _sum: { balanceOutstandingPkr: true },
    });
    expect(gl).toBeCloseTo(Number(register._sum.balanceOutstandingPkr ?? 0), 2);
    expect(gl).toBeGreaterThan(0);
  });
});

const reverse = (runId: string, payload: Record<string, unknown> = { reason: 'posted in error', reversal_date: '2028-12-31' }) =>
  app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/reverse`, headers: authHeaders(ownerToken), payload });
const voidPayment = (runId: string, payload: Record<string, unknown> = { reason: 'paid from the wrong account' }) =>
  app.inject({ method: 'POST', url: `/v1/payroll-runs/${runId}/void-payment`, headers: authHeaders(ownerToken), payload });

describe('C-15 — reversing a run undoes the accrual; voiding a payment is its own action', () => {
  it('a PAID run cannot be reversed: the salary cash really left', async () => {
    await salaried(30000);
    const run = await draft(2028, 5);
    expect((await finalize(run.id)).statusCode).toBe(200);
    expect((await pay(run.id, '2028-06-01')).statusCode).toBe(200);

    const res = await reverse(run.id);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PAYROLL_RUN_NOT_REVERSIBLE');
    expect(await entriesOf(run.id, 'REVERSAL')).toHaveLength(0);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('PAID');
  });

  it('voiding the payment mirrors JE-16 only, returns the run to FINALIZED, and it can be paid again', async () => {
    await salaried(30000);
    const run = await draft(2028, 6);
    expect((await finalize(run.id)).statusCode).toBe(200);
    const paid = JSON.parse((await pay(run.id, '2028-07-01')).body).data;

    const res = await voidPayment(run.id, { reason: 'paid from the wrong account', void_date: '2028-07-02' });
    expect(res.statusCode, res.body).toBe(200);
    const after = JSON.parse(res.body).data;
    expect(after.status).toBe('FINALIZED');
    expect(after.payment_journal_entry_id).toBeNull();
    expect(after.paid_at).toBeNull();

    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: paid.payment_journal_entry_id } });
    expect(original.reversedById).toBeTruthy();
    const mirrors = await entriesOf(run.id, 'REVERSAL');
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]!.id).toBe(original.reversedById);
    // The accrual stands untouched.
    const accrual = await prisma.journalEntry.findUniqueOrThrow({ where: { id: after.payroll_journal_entry_id } });
    expect(accrual.reversedById).toBeNull();

    expect((await pay(run.id, '2028-07-03')).statusCode).toBe(200);
    expect(await entriesOf(run.id, 'PAYROLL_PAYMENT')).toHaveLength(2);
  });

  it('a payment can only be voided on a PAID run', async () => {
    await salaried(30000);
    const run = await draft(2028, 7);
    expect((await finalize(run.id)).statusCode).toBe(200);
    const res = await voidPayment(run.id);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PAYROLL_RUN_INVALID_STATUS');
  });

  it('reversing an unpaid run records the cancellation on the run, not in its notes', async () => {
    await salaried(30000);
    const run = await draft(2028, 8);
    expect((await finalize(run.id)).statusCode).toBe(200);

    const res = await reverse(run.id, { reason: 'wrong month', reversal_date: '2028-09-01' });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.status).toBe('REVERSED');
    expect(body.void_reason).toBe('wrong month');
    expect(body.voided_at).toBeTruthy();

    const row = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(row.notes).toBeNull();
    expect(row.voidedBy).toBeTruthy();
    expect(await entriesOf(run.id, 'REVERSAL')).toHaveLength(1);
  });

  it('a remitted run cannot be reversed: the remittance cash left too', async () => {
    await salaried(30000);
    const run = await draft(2028, 9);
    expect((await finalize(run.id)).statusCode).toBe(200);
    const remit = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/remit`,
      headers: authHeaders(ownerToken),
      payload: { remittance_date: '2028-10-05', remit_employee_eobi_pkr: 375, remit_employer_eobi_pkr: 1875 },
    });
    expect(remit.statusCode, remit.body).toBe(201);

    const res = await reverse(run.id);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PAYROLL_RUN_NOT_REVERSIBLE');
    expect(await entriesOf(run.id, 'REVERSAL')).toHaveLength(0);
  });
});
