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
  // Reversals cross-link entries via the reversed_by self-FK; break it before deleting.
  await prisma.journalEntry.updateMany({
    where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payroll_runs' },
    data: { reversedById: null },
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

  // C1(i). JE-15B had no 2070 line at all and finalize never passed tax to it, so any
  // daily-wage run with income tax failed the balance check and could never leave DRAFT.
  it('finalizes a DAILY_WAGES run carrying income tax (JE-15B credits 2070)', async () => {
    await cleanup();
    await createDailyWage(`Loader-${Date.now()}`, 1000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'DAILY_WAGES',
        period_year: 2026,
        period_month: 8,
        period_from: '2026-08-01',
        period_to: '2026-08-31',
      },
    });
    expect(create.statusCode).toBe(201);
    const run = JSON.parse(create.body).data;

    const upd = await app.inject({
      method: 'PATCH',
      url: `/v1/payroll-runs/${run.id}/lines/${run.line_items[0].id}`,
      headers: authHeaders(accountantToken),
      payload: { income_tax_pkr: 900 },
    });
    expect(upd.statusCode).toBe(200);

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);

    const je = await prisma.journalEntry.findFirst({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payroll_runs', sourceId: run.id },
      include: { lines: true },
    });
    expect(je).toBeTruthy();
    expect(Number(je!.lines.find((l) => l.accountCode === '2070')?.creditAmount)).toBe(900);

    const d = je!.lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const c = je!.lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(d).toBeCloseTo(c, 2);
  });

  // C1(ii). other_deductions_pkr is subtracted from net pay but has no JE line, so the
  // entry came up short by exactly that amount and threw JOURNAL_UNBALANCED — a message
  // that told the accountant nothing. It has no correct account to credit until employee
  // advances exist, so refuse it explicitly instead.
  it('rejects finalize with a clear error when a line carries other deductions', async () => {
    await cleanup();
    await createSalaried(`Mgr-OD-${Date.now()}`, 50000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 9,
        period_from: '2026-09-01',
        period_to: '2026-09-30',
      },
    });
    const run = JSON.parse(create.body).data;

    await app.inject({
      method: 'PATCH',
      url: `/v1/payroll-runs/${run.id}/lines/${run.line_items[0].id}`,
      headers: authHeaders(accountantToken),
      payload: { other_deductions_pkr: 2500 },
    });

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(409);
    expect(JSON.parse(fin.body).error.code).toBe('PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED');

    // Nothing was posted and the run stayed in DRAFT.
    const je = await prisma.journalEntry.findFirst({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payroll_runs', sourceId: run.id },
    });
    expect(je).toBeNull();
    const after = await prisma.payrollRun.findUnique({ where: { id: run.id } });
    expect(after!.status).toBe('DRAFT');
  });

  // C2. remit overwrote remittance_journal_entry_id instead of rejecting, so a second
  // call posted a second JE-16B and orphaned the first link.
  it('rejects a second remittance instead of posting a duplicate JE-16B', async () => {
    await cleanup();
    await createSalaried(`Mgr-Rem-${Date.now()}`, 40000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 10,
        period_from: '2026-10-01',
        period_to: '2026-10-31',
      },
    });
    const run = JSON.parse(create.body).data;

    await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });

    const remitPayload = {
      remittance_date: '2026-11-05',
      remit_employee_eobi_pkr: 375,
      remit_employer_eobi_pkr: 1875,
      remit_income_tax_pkr: 0,
    };

    const first = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/remit`,
      headers: authHeaders(ownerToken),
      payload: remitPayload,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/remit`,
      headers: authHeaders(ownerToken),
      payload: remitPayload,
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('PAYROLL_ALREADY_REMITTED');

    const remittances = await prisma.journalEntry.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        sourceTable: 'payroll_runs',
        sourceId: run.id,
        entryType: 'GOVT_REMITTANCE',
      },
    });
    expect(remittances).toHaveLength(1);
  });

  // C3. The duplicate-period check ran outside the transaction that wrote the row, and
  // the table has only a non-unique index on (facility, year, month) — so two concurrent
  // creates could both pass it.
  it('two concurrent creates for the same period+type — exactly one wins', async () => {
    await cleanup();
    await createSalaried(`Mgr-Race-${Date.now()}`, 30000);

    const payload = {
      payroll_type: 'MONTHLY_SALARY',
      period_year: 2026,
      period_month: 11,
      period_from: '2026-11-01',
      period_to: '2026-11-30',
    };
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: authHeaders(accountantToken), payload }),
      app.inject({ method: 'POST', url: '/v1/payroll-runs', headers: authHeaders(accountantToken), payload }),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const runs = await prisma.payrollRun.findMany({
      where: { facilityId: TEST_FACILITY_ID, periodYear: 2026, periodMonth: 11, payrollType: 'MONTHLY_SALARY' },
    });
    expect(runs).toHaveLength(1);
  });

  // E / P1-3. Before this, a run finalized in error was terminal: no cancel, no reverse,
  // and the generic JE-reversal endpoint rejects system-sourced entries. The duplicate-
  // period guard then blocked creating a corrected replacement for that period.
  it('reverses a FINALIZED run: mirror JE posted, original marked REVERSED, run REVERSED', async () => {
    await cleanup();
    await createSalaried(`Mgr-Rev-${Date.now()}`, 44000);

    const create = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2027,
        period_month: 3,
        period_from: '2027-03-01',
        period_to: '2027-03-31',
      },
    });
    const run = JSON.parse(create.body).data;

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);
    const originalJeId = JSON.parse(fin.body).data.payroll_journal_entry_id as string;
    expect(originalJeId).toBeTruthy();

    const rev = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${run.id}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Wrong salary snapshot', reversal_date: '2027-04-02' },
    });
    expect(rev.statusCode).toBe(200);
    expect(JSON.parse(rev.body).data.status).toBe('REVERSED');

    // Original flipped to REVERSED and cross-linked.
    const original = await prisma.journalEntry.findUnique({ where: { id: originalJeId } });
    expect(original!.postingStatus).toBe('REVERSED');
    expect(original!.reversedById).toBeTruthy();

    // The mirror exists and is the exact opposite of the original.
    const mirror = await prisma.journalEntry.findUnique({
      where: { id: original!.reversedById! },
      include: { lines: true },
    });
    expect(mirror!.entryType).toBe('REVERSAL');
    const originalLines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: originalJeId },
    });
    const sum = (ls: { debitAmount: unknown; creditAmount: unknown }[], k: 'debitAmount' | 'creditAmount') =>
      ls.reduce((s, l) => s + Number(l[k]), 0);
    expect(sum(mirror!.lines, 'debitAmount')).toBeCloseTo(sum(originalLines, 'creditAmount'), 2);
    expect(sum(mirror!.lines, 'creditAmount')).toBeCloseTo(sum(originalLines, 'debitAmount'), 2);

    // Net effect on the ledger is zero for every account the run touched.
    const byAccount = new Map<string, number>();
    for (const l of [...originalLines, ...mirror!.lines]) {
      byAccount.set(
        l.accountCode,
        (byAccount.get(l.accountCode) ?? 0) + Number(l.debitAmount) - Number(l.creditAmount),
      );
    }
    for (const [, net] of byAccount) expect(net).toBeCloseTo(0, 2);
  });

  it('a REVERSED run no longer blocks a replacement for the same period', async () => {
    // Same period as the reversal test above — previously PAYROLL_RUN_DUPLICATE_PERIOD.
    const replacement = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2027,
        period_month: 3,
        period_from: '2027-03-01',
        period_to: '2027-03-31',
      },
    });
    expect(replacement.statusCode).toBe(201);
    // ...and it takes the next number in that month's sequence.
    expect(JSON.parse(replacement.body).data.run_number).toMatch(/^PAY-202703-\d{3}$/);
  });

  it('rejects reversing a DRAFT run and reversing the same run twice', async () => {
    // Give the draft at least one line — a run with no line items is a valid but
    // degenerate fixture that later tests reading `data[0]` would trip over.
    await createDailyWage(`Loader-Rev-${Date.now()}`, 900);

    const draft = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(accountantToken),
      payload: {
        payroll_type: 'DAILY_WAGES',
        period_year: 2027,
        period_month: 4,
        period_from: '2027-04-01',
        period_to: '2027-04-30',
      },
    });
    const draftId = JSON.parse(draft.body).data.id;

    const onDraft = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${draftId}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'nothing posted yet' },
    });
    expect(onDraft.statusCode).toBe(409);
    expect(JSON.parse(onDraft.body).error.code).toBe('PAYROLL_RUN_NOT_REVERSIBLE');

    // The 2027-03 run reversed above cannot be reversed again.
    const already = await prisma.payrollRun.findFirst({
      where: { facilityId: TEST_FACILITY_ID, periodYear: 2027, periodMonth: 3, status: 'REVERSED' },
    });
    const twice = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${already!.id}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'again' },
    });
    expect(twice.statusCode).toBe(409);
    expect(JSON.parse(twice.body).error.code).toBe('PAYROLL_RUN_NOT_REVERSIBLE');
  });

  it('payroll reversal is OWNER-gated (ACCOUNTANT forbidden)', async () => {
    const already = await prisma.payrollRun.findFirst({
      where: { facilityId: TEST_FACILITY_ID, periodYear: 2027, periodMonth: 3, status: 'REVERSED' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${already!.id}/reverse`,
      headers: authHeaders(accountantToken),
      payload: { reason: 'not allowed' },
    });
    expect(res.statusCode).toBe(403);
  });

  // Invariant 11: whatever else changes, a run that reached FINALIZED must have a
  // balanced entry behind it.
  it('invariant — every FINALIZED payroll run has a balanced journal entry', async () => {
    const runs = await prisma.payrollRun.findMany({
      where: { facilityId: TEST_FACILITY_ID, status: { in: ['FINALIZED', 'PAID'] } },
      select: { id: true, payrollJournalEntryId: true },
    });
    for (const r of runs) {
      expect(r.payrollJournalEntryId).toBeTruthy();
      const lines = await prisma.journalEntryLine.findMany({
        where: { journalEntryId: r.payrollJournalEntryId! },
      });
      const d = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
      const c = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
      expect(d).toBeCloseTo(c, 2);
    }
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
