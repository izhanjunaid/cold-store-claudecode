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
