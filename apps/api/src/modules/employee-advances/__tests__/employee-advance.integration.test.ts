import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let accountantToken: string;
let operatorToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, cleanupInner);
}

async function cleanupInner() {
  await prisma.employeeAdvanceRecovery.deleteMany({
    where: { advance: { facilityId: TEST_FACILITY_ID } },
  });
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
  await prisma.journalEntryLine.deleteMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      journalEntry: { OR: [{ sourceTable: 'employee_advances' }, { sourceTable: 'payroll_runs' }] },
    },
  });
  await prisma.journalEntry.updateMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      OR: [{ sourceTable: 'employee_advances' }, { sourceTable: 'payroll_runs' }],
    },
    data: { reversedById: null },
  });
  await prisma.journalEntry.deleteMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      OR: [{ sourceTable: 'employee_advances' }, { sourceTable: 'payroll_runs' }],
    },
  });
  await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

async function createSalaried(name: string, salary = 50000) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/employees',
    headers: authHeaders(ownerToken),
    payload: {
      name,
      employee_type: 'SALARIED',
      designation: 'Clerk',
      join_date: '2026-01-01',
      basic_salary_pkr: salary,
      eobi_registered: true,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id as string;
}

async function issueAdvance(employeeId: string, principal = 10000, installment = 5000, date = '2026-05-10') {
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
  return res;
}

describe('Phase 21 — Employee Advances', () => {
  it('issues an advance with ADV-YYMMDD-NNN format and posts JE-22 (DR 1230 / CR 1010)', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-Emp-${Date.now()}`, 50000);
    const res = await issueAdvance(empId, 10000, 5000, '2026-05-10');
    expect(res.statusCode).toBe(201);
    const advance = JSON.parse(res.body).data;
    expect(advance.advance_number).toMatch(/^ADV-260510-\d{3}$/);
    expect(advance.status).toBe('ACTIVE');
    expect(advance.balance_outstanding_pkr).toBe(10000);

    const je = await prisma.journalEntry.findUnique({
      where: { id: advance.issue_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('EMPLOYEE_ADVANCE_ISSUE');
    expect(je?.lines.find((l) => l.accountCode === '1230')?.debitAmount.toString()).toBe('10000');
    expect(je?.lines.find((l) => l.accountCode === '1010')?.creditAmount.toString()).toBe('10000');
  });

  it('rejects a second advance while one is ACTIVE', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-Dup-${Date.now()}`, 50000);
    const first = await issueAdvance(empId, 10000);
    expect(first.statusCode).toBe(201);

    const second = await issueAdvance(empId, 5000);
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('EMPLOYEE_ADVANCE_ALREADY_ACTIVE');
  });

  it('rejects a principal above one month\'s pay', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-Cap-${Date.now()}`, 40000);
    const res = await issueAdvance(empId, 40001);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('EMPLOYEE_ADVANCE_EXCEEDS_CAP');
  });

  // The "one active advance" check is a plain findFirst-then-create; without a lock,
  // two concurrent issue() calls could both see nothing and both insert.
  it('two concurrent issues for the same employee — exactly one wins', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-Race-${Date.now()}`, 50000);

    const [a, b] = await Promise.all([issueAdvance(empId, 5000), issueAdvance(empId, 5000)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const active = await prisma.employeeAdvance.findMany({
      where: { facilityId: TEST_FACILITY_ID, employeeId: empId, status: 'ACTIVE' },
    });
    expect(active).toHaveLength(1);
  });

  it('writes off an advance: DR 6080 / CR 1230; rejects writing off twice', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-WriteOff-${Date.now()}`, 50000);
    const issued = JSON.parse((await issueAdvance(empId, 8000)).body).data;

    const wo = await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${issued.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Employee left the company' },
    });
    expect(wo.statusCode).toBe(200);
    const written = JSON.parse(wo.body).data;
    expect(written.status).toBe('WRITTEN_OFF');
    expect(written.balance_outstanding_pkr).toBe(0);

    const je = await prisma.journalEntry.findUnique({
      where: { id: written.write_off_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('EMPLOYEE_ADVANCE_WRITE_OFF');
    expect(je?.lines.find((l) => l.accountCode === '6080')?.debitAmount.toString()).toBe('8000');
    expect(je?.lines.find((l) => l.accountCode === '1230')?.creditAmount.toString()).toBe('8000');

    const again = await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${issued.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'again' },
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('EMPLOYEE_ADVANCE_ALREADY_CLOSED');
  });

  it('RBAC: ACCOUNTANT cannot issue or write off; OPERATOR cannot view', async () => {
    await cleanup();
    const empId = await createSalaried(`Advance-RBAC-${Date.now()}`, 50000);

    const issueAsAccountant = await app.inject({
      method: 'POST',
      url: '/v1/employee-advances/issue',
      headers: authHeaders(accountantToken),
      payload: {
        employee_id: empId,
        issue_date: '2026-05-10',
        principal_pkr: 5000,
        monthly_installment_pkr: 2500,
        payment_method: 'CASH',
      },
    });
    expect(issueAsAccountant.statusCode).toBe(403);

    const issued = JSON.parse((await issueAdvance(empId, 5000)).body).data;

    const writeOffAsAccountant = await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${issued.id}/write-off`,
      headers: authHeaders(accountantToken),
      payload: { reason: 'not allowed' },
    });
    expect(writeOffAsAccountant.statusCode).toBe(403);

    const listAsOperator = await app.inject({
      method: 'GET',
      url: '/v1/employee-advances',
      headers: authHeaders(operatorToken),
    });
    expect(listAsOperator.statusCode).toBe(403);
  });

  // Invariant 10 (mirrors the GL-1140 peshgi tie-out from phase/19): the GL control
  // account for employee advances must equal the sum of outstanding subledger balances.
  it('invariant — GL 1230 balance equals the sum of outstanding advance balances', async () => {
    await cleanup();
    const emp1 = await createSalaried(`Advance-Inv1-${Date.now()}`, 50000);
    const emp2 = await createSalaried(`Advance-Inv2-${Date.now()}`, 50000);
    await issueAdvance(emp1, 12000);
    await issueAdvance(emp2, 7000);

    const outstanding = await prisma.employeeAdvance.aggregate({
      where: { facilityId: TEST_FACILITY_ID, status: 'ACTIVE' },
      _sum: { balanceOutstandingPkr: true },
    });

    const lines = await prisma.journalEntryLine.findMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '1230' },
    });
    const glBalance = lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0);

    expect(glBalance).toBeCloseTo(Number(outstanding._sum.balanceOutstandingPkr ?? 0), 2);
  });
});
