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

const ADVANCE_SOURCES = ['employee_advances', 'employee_advance_recoveries', 'payroll_runs'];

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
    where: { facilityId: TEST_FACILITY_ID, journalEntry: { sourceTable: { in: ADVANCE_SOURCES } } },
  });
  await prisma.journalEntry.updateMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: { in: ADVANCE_SOURCES } },
    data: { reversedById: null },
  });
  await prisma.journalEntry.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: { in: ADVANCE_SOURCES } },
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
      source_asset_account_code: '1010',
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

  // docs/25 C-27: a forgiven staff advance is a staff benefit (6190), not a bad debt (6080).
  it('writes off an advance: DR 6190 / CR 1230; rejects writing off twice', async () => {
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
    expect(je?.lines.find((l) => l.accountCode === '6190')?.debitAmount.toString()).toBe('8000');
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
        source_asset_account_code: '1010',
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

// docs/25 C-26: an advance issued in error can be voided, and an employee can
// repay in cash — before this, 1230 could only move through payroll or a write-off.
describe('C-26 — void an advance, repay one in cash', () => {
  function repay(advanceId: string, amount: number, date = '2026-05-20', account = '1010', token = ownerToken) {
    return app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${advanceId}/repayments`,
      headers: authHeaders(token),
      payload: { repayment_date: date, amount_pkr: amount, asset_account_code: account },
    });
  }
  function voidAdvance(advanceId: string, token = ownerToken) {
    return app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${advanceId}/void`,
      headers: authHeaders(token),
      payload: { reason: 'Issued to the wrong employee' },
    });
  }
  function voidRepayment(advanceId: string, recoveryId: string, token = ownerToken) {
    return app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${advanceId}/repayments/${recoveryId}/void`,
      headers: authHeaders(token),
      payload: { reason: 'Cash was never received' },
    });
  }
  async function gl1230() {
    const lines = await prisma.journalEntryLine.findMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '1230' },
    });
    return lines.reduce((s, l) => s + Number(l.debitAmount) - Number(l.creditAmount), 0);
  }

  it('a cash repayment posts DR cash / CR 1230 and closes the advance when it clears the balance', async () => {
    const empId = await createSalaried(`Advance-Repay-${Date.now()}`, 50000);
    const issued = JSON.parse((await issueAdvance(empId, 10000)).body).data;
    expect(issued.allowed_actions).toEqual(['repay', 'write_off', 'void']);
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/employee-advances?employee_id=${empId}`,
      headers: authHeaders(ownerToken),
    });
    expect(listed.statusCode).toBe(200);
    expect(JSON.parse(listed.body).data[0].allowed_actions).toEqual(['repay', 'write_off', 'void']);

    const first = await repay(issued.id, 4000, '2026-05-20', '1020');
    expect(first.statusCode).toBe(201);
    const afterFirst = JSON.parse(first.body).data;
    expect(afterFirst.balance_outstanding_pkr).toBe(6000);
    expect(afterFirst.status).toBe('ACTIVE');
    expect(afterFirst.allowed_actions).toEqual(['repay', 'write_off']);
    const recovery = afterFirst.recoveries[0];
    expect(recovery).toMatchObject({ kind: 'CASH', amount_pkr: 4000, asset_account_code: '1020', payroll_run_id: null, can_void: true });

    const je = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: recovery.journal_entry_id },
      include: { lines: true },
    });
    expect(je.entryType).toBe('EMPLOYEE_ADVANCE_REPAYMENT');
    expect(je.sourceTable).toBe('employee_advance_recoveries');
    expect(je.sourceId).toBe(recovery.id);
    expect(je.lines.find((l) => l.accountCode === '1020')?.debitAmount.toString()).toBe('4000');
    expect(je.lines.find((l) => l.accountCode === '1230')?.creditAmount.toString()).toBe('4000');

    const over = await repay(issued.id, 6000.01);
    expect(over.statusCode).toBe(422);
    expect(JSON.parse(over.body).error.code).toBe('EMPLOYEE_ADVANCE_OVER_RECOVERY');

    const rest = JSON.parse((await repay(issued.id, 6000)).body).data;
    expect(rest.status).toBe('RECOVERED');
    expect(rest.balance_outstanding_pkr).toBe(0);
    expect(rest.allowed_actions).toEqual([]);
  });

  it('a repayment must land in a cash or bank account, on or after the issue date', async () => {
    const empId = await createSalaried(`Advance-RepayAcct-${Date.now()}`, 50000);
    const issued = JSON.parse((await issueAdvance(empId, 5000, 2500, '2026-05-10')).body).data;

    for (const account of ['1025', '6190', '1000']) {
      const res = await repay(issued.id, 1000, '2026-05-20', account);
      expect(res.statusCode, account).toBe(422);
      expect(JSON.parse(res.body).error.code, account).toBe('NOT_A_CASH_ACCOUNT');
    }
    const early = await repay(issued.id, 1000, '2026-05-09');
    expect(early.statusCode).toBe(400);

    const asAccountant = await repay(issued.id, 1000, '2026-05-20', '1010', accountantToken);
    expect(asAccountant.statusCode).toBe(403);
  });

  it('voids an advance issued in error — only while nothing has been recovered', async () => {
    const empId = await createSalaried(`Advance-Void-${Date.now()}`, 50000);
    const issued = JSON.parse((await issueAdvance(empId, 9000)).body).data;
    const repaid = JSON.parse((await repay(issued.id, 2000)).body).data;

    const blocked = await voidAdvance(issued.id);
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).error.code).toBe('EMPLOYEE_ADVANCE_HAS_RECOVERIES');

    const undone = await voidRepayment(issued.id, repaid.recoveries[0].id);
    expect(undone.statusCode).toBe(200);
    expect(JSON.parse(undone.body).data.balance_outstanding_pkr).toBe(9000);
    const repaymentJe = await prisma.journalEntry.findUniqueOrThrow({ where: { id: repaid.recoveries[0].journal_entry_id } });
    expect(repaymentJe.reversedById).not.toBeNull();

    expect((await voidAdvance(issued.id, accountantToken)).statusCode).toBe(403);
    const voided = await voidAdvance(issued.id);
    expect(voided.statusCode).toBe(200);
    const body = JSON.parse(voided.body).data;
    expect(body).toMatchObject({ status: 'VOIDED', balance_outstanding_pkr: 0, void_reason: 'Issued to the wrong employee', allowed_actions: [] });
    expect(body.voided_at).not.toBeNull();
    const issueJe = await prisma.journalEntry.findUniqueOrThrow({ where: { id: issued.issue_journal_entry_id } });
    expect(issueJe.reversedById).not.toBeNull();

    const again = await voidAdvance(issued.id);
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('EMPLOYEE_ADVANCE_ALREADY_CLOSED');

    // A voided advance no longer blocks a new one.
    expect((await issueAdvance(empId, 3000)).statusCode).toBe(201);
  });

  it('voiding a repayment reopens the advance — unless it was written off or another is now active', async () => {
    const empA = await createSalaried(`Advance-Reopen-${Date.now()}`, 50000);
    const first = JSON.parse((await issueAdvance(empA, 5000)).body).data;
    const cleared = JSON.parse((await repay(first.id, 5000)).body).data;
    expect(cleared.status).toBe('RECOVERED');
    expect((await issueAdvance(empA, 3000)).statusCode).toBe(201);

    const reopen = await voidRepayment(first.id, cleared.recoveries[0].id);
    expect(reopen.statusCode).toBe(409);
    expect(JSON.parse(reopen.body).error.code).toBe('EMPLOYEE_ADVANCE_ALREADY_ACTIVE');

    const empB = await createSalaried(`Advance-WoRepay-${Date.now()}`, 50000);
    const second = JSON.parse((await issueAdvance(empB, 6000)).body).data;
    const part = JSON.parse((await repay(second.id, 1000)).body).data;
    await app.inject({
      method: 'POST',
      url: `/v1/employee-advances/${second.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Employee left' },
    });
    const afterWriteOff = JSON.parse(
      (await app.inject({ method: 'GET', url: `/v1/employee-advances/${second.id}`, headers: authHeaders(ownerToken) })).body,
    ).data;
    expect(afterWriteOff.recoveries[0].can_void).toBe(false);
    const blocked = await voidRepayment(second.id, part.recoveries[0].id);
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).error.code).toBe('EMPLOYEE_ADVANCE_RECOVERY_NOT_VOIDABLE');
  });

  // Reopening a RECOVERED advance and issuing a new one both create an ACTIVE
  // advance for the employee; they must serialise on the same lock.
  it('reopening an advance races a new issue — exactly one wins', async () => {
    const empId = await createSalaried(`Advance-ReopenRace-${Date.now()}`, 50000);
    const issued = JSON.parse((await issueAdvance(empId, 5000)).body).data;
    const cleared = JSON.parse((await repay(issued.id, 5000)).body).data;

    const [reopen, fresh] = await Promise.all([
      voidRepayment(issued.id, cleared.recoveries[0].id),
      issueAdvance(empId, 2000),
    ]);
    // The loser is refused, whichever it is.
    const codes = [reopen.statusCode, fresh.statusCode];
    expect(codes.filter((c) => c === 409)).toHaveLength(1);
    expect(codes.filter((c) => c === 200 || c === 201)).toHaveLength(1);
    const active = await prisma.employeeAdvance.count({
      where: { facilityId: TEST_FACILITY_ID, employeeId: empId, status: 'ACTIVE' },
    });
    expect(active).toBe(1);
  });

  it('invariant — GL 1230 equals the sum of advance balances through repay, void repayment and void issue', async () => {
    await cleanup();
    const emp1 = await createSalaried(`Advance-Inv3-${Date.now()}`, 50000);
    const emp2 = await createSalaried(`Advance-Inv4-${Date.now()}`, 50000);
    const a = JSON.parse((await issueAdvance(emp1, 12000)).body).data;
    const b = JSON.parse((await issueAdvance(emp2, 7000)).body).data;
    await repay(a.id, 2500);
    const bRepaid = JSON.parse((await repay(b.id, 1500)).body).data;
    await voidRepayment(b.id, bRepaid.recoveries[0].id);
    await voidAdvance(b.id);

    const all = await prisma.employeeAdvance.aggregate({
      where: { facilityId: TEST_FACILITY_ID },
      _sum: { balanceOutstandingPkr: true },
    });
    expect(Number(all._sum.balanceOutstandingPkr)).toBe(9500);
    expect(await gl1230()).toBeCloseTo(9500, 2);
  });
});
