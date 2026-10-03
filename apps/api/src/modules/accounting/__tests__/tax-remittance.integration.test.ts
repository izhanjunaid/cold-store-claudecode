/**
 * docs/25 C-10 — one statutory remittance, by period, for every liability the facility
 * pays over to the state: EOBI (2060/2061), salary tax s.149 (2070), supplier s.153
 * (2071) and rent s.155 (2072).
 *
 * There used to be two models: JE-29 paid 2071/2072 by period from the GL (as a bare
 * entry, PACCI hardcoded, no void), while each payroll run remitted its own 2060/2061/
 * 2070 once, with amounts summed in the browser. A remittance is now a document: the
 * amount is what the ledger says is outstanding at the period end, it carries the
 * challan / CPR number, and it voids through the reversal path.
 *
 * Dated 2039, with a supplier and an employee this file creates, cleaned up by id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();
const OWN_BANK = '1049';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;

const partyIds: string[] = [];
const employeeIds: string[] = [];
const runIds: string[] = [];
const remittanceIds: string[] = [];

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
      accountName: 'Second bank — tax remittance test',
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
    const payments = await prisma.supplierPayment.findMany({ where: { supplierPartyId: { in: partyIds } }, select: { id: true } });
    const paymentIds = payments.map((p) => p.id);
    const scope = {
      facilityId: TEST_FACILITY_ID,
      OR: [
        { sourceTable: 'supplier_payments', sourceId: { in: paymentIds } },
        { sourceTable: 'tax_remittances', sourceId: { in: remittanceIds } },
        { sourceTable: 'payroll_runs', sourceId: { in: runIds } },
      ],
    };
    await prisma.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: { in: paymentIds } } });
    await prisma.supplierPayment.updateMany({ where: { id: { in: paymentIds } }, data: { journalEntryId: null } });
    await prisma.supplierPayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.taxRemittance.updateMany({ where: { id: { in: remittanceIds } }, data: { journalEntryId: null } });
    await prisma.taxRemittance.deleteMany({ where: { id: { in: remittanceIds } } });
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
    await prisma.party.deleteMany({ where: { id: { in: partyIds } } });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });
const dataOf = (res: { body: string }) => JSON.parse(res.body).data;

async function outstanding(accountCode: string, year = 2039, month = 3): Promise<number> {
  const res = await call('GET', `/v1/accounting/tax-remittances/outstanding?period_year=${year}&period_month=${month}`, ownerToken);
  expect(res.statusCode, res.body).toBe(200);
  const row = (dataOf(res) as Array<{ account_code: string; outstanding_pkr: number }>).find((r) => r.account_code === accountCode);
  expect(row, `${accountCode} is a statutory liability`).toBeTruthy();
  return row!.outstanding_pkr;
}

const remit = (payload: Record<string, unknown>, token = ownerToken) =>
  call('POST', '/v1/accounting/tax-remittances', token, {
    period_year: 2039,
    period_month: 3,
    remittance_date: '2039-04-10',
    paid_from_account_code: OWN_BANK,
    ...payload,
  }).then((res) => {
    if (res.statusCode === 201) remittanceIds.push(dataOf(res).id);
    return res;
  });

async function withholdFromSupplier(gross: number) {
  const party = await call('POST', '/v1/parties', ownerToken, {
    name: `TR Supplier ${Date.now()}`,
    party_type: 'SUPPLIER',
    phone_primary: `0391${String(Date.now()).slice(-7)}`,
  });
  expect(party.statusCode, party.body).toBe(201);
  partyIds.push(dataOf(party).id);
  const pay = await call('POST', '/v1/supplier-payments', accountantToken, {
    supplier_party_id: dataOf(party).id,
    payment_date: '2039-03-15',
    payment_method: 'BANK_TRANSFER',
    gross_amount_pkr: gross,
    withholding_section: 'S153',
    withholding_rate_pct: 4,
    certificate_number: 'CERT-TR-1',
  });
  expect(pay.statusCode, pay.body).toBe(201);
  return dataOf(pay);
}

describe('C-10 — a statutory remittance is a document, by period, from the ledger', () => {
  it('pays over what 2071 owes at the period end, with its challan, from an owner-added bank', async () => {
    await withholdFromSupplier(10000);
    const owed = await outstanding('2071');
    expect(owed).toBeGreaterThanOrEqual(400);

    const res = await remit({ liability_account_code: '2071', challan_number: 'CPR-2039-0001' });
    expect(res.statusCode, res.body).toBe(201);
    const doc = dataOf(res);
    expect(doc).toMatchObject({
      liability_account_code: '2071',
      period_year: 2039,
      period_month: 3,
      remittance_date: '2039-04-10',
      amount_pkr: owed,
      paid_from_account_code: OWN_BANK,
      challan_number: 'CPR-2039-0001',
      voided_at: null,
      allowed_actions: ['void'],
    });

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: doc.journal_entry_id }, include: { lines: true } });
    expect(entry).toMatchObject({ entryType: 'TAX_REMITTANCE', sourceTable: 'tax_remittances', sourceId: doc.id });
    expect(Number(entry.lines.find((l) => l.accountCode === '2071')!.debitAmount)).toBe(owed);
    expect(Number(entry.lines.find((l) => l.accountCode === OWN_BANK)!.creditAmount)).toBe(owed);

    expect(await outstanding('2071')).toBe(0);
  });

  it('pays a period over only once, though the entry is dated after it', async () => {
    const res = await remit({ liability_account_code: '2071', remittance_date: '2039-05-15' });
    expect(res.statusCode).toBe(422);
  });

  it('refuses a date before the period closed, a non-statutory account, and cheques in hand', async () => {
    const early = await remit({ liability_account_code: '2072', remittance_date: '2039-03-20' });
    expect(early.statusCode).toBe(400);
    expect(early.body).toContain('remittance_date');

    const trade = await remit({ liability_account_code: '2050' });
    expect(trade.statusCode).toBe(400);

    await withholdFromSupplier(5000);
    const cheque = await remit({ liability_account_code: '2071', paid_from_account_code: '1025' });
    expect(cheque.statusCode).toBe(422);
    expect(JSON.parse(cheque.body).error.code).toBe('NOT_A_CASH_ACCOUNT');
  });

  it('two concurrent remittances of the same liability: exactly one pays', async () => {
    const owed = await outstanding('2071');
    expect(owed).toBeGreaterThan(0);
    const [a, b] = await Promise.all([
      remit({ liability_account_code: '2071' }),
      remit({ liability_account_code: '2071' }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422]);
    expect(await outstanding('2071')).toBe(0);
  });

  it('is paid over by those allowed to remit deductions — not a manager', async () => {
    const res = await remit({ liability_account_code: '2072' }, managerToken);
    expect(res.statusCode).toBe(403);
  });

  it('voids through the reversal path and owes the amount again', async () => {
    await withholdFromSupplier(2500);
    const owed = await outstanding('2071');
    const doc = dataOf(await remit({ liability_account_code: '2071' }));

    const voided = await call('POST', `/v1/accounting/tax-remittances/${doc.id}/void`, ownerToken, {
      reason: 'wrong challan',
      void_date: '2039-04-10',
    });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(dataOf(voided)).toMatchObject({ void_reason: 'wrong challan', allowed_actions: [] });
    expect(await outstanding('2071')).toBe(owed);

    const list = await call('GET', '/v1/accounting/tax-remittances?period_year=2039', ownerToken);
    expect(list.statusCode, list.body).toBe(200);
    expect((dataOf(list) as Array<{ id: string }>).map((r) => r.id)).toContain(doc.id);
  });
});

describe('C-10 — payroll deductions are remitted the same way; a run no longer remits itself', () => {
  it('EOBI from a finalised run is outstanding on 2060/2061 and remitted by period; the run offers no remit', async () => {
    const emp = await call('POST', '/v1/employees', ownerToken, {
      name: `TR-Sal-${Date.now()}`,
      employee_type: 'SALARIED',
      basic_salary_pkr: 40000,
      join_date: '2038-01-01',
      eobi_registered: true,
    });
    expect(emp.statusCode, emp.body).toBe(201);
    employeeIds.push(dataOf(emp).id);

    const draft = await call('POST', '/v1/payroll-runs', accountantToken, {
      payroll_type: 'MONTHLY_SALARY',
      period_year: 2039,
      period_month: 3,
      period_from: '2039-03-01',
      period_to: '2039-03-31',
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const runId = dataOf(draft).id;
    runIds.push(runId);
    const finalized = await call('POST', `/v1/payroll-runs/${runId}/finalize`, managerToken, {});
    expect(finalized.statusCode, finalized.body).toBe(200);
    expect(dataOf(finalized).allowed_actions).not.toContain('remit');

    const legacy = await call('POST', `/v1/payroll-runs/${runId}/remit`, ownerToken, {
      remittance_date: '2039-04-05',
      remit_employee_eobi_pkr: 1,
      remit_employer_eobi_pkr: 1,
    });
    expect(legacy.statusCode).toBe(404);

    for (const code of ['2060', '2061']) {
      const owed = await outstanding(code);
      expect(owed, code).toBeGreaterThan(0);
      const res = await remit({ liability_account_code: code, challan_number: `EOBI-${code}` });
      expect(res.statusCode, res.body).toBe(201);
      expect(await outstanding(code)).toBe(0);
    }
  });
});

describe('the withholding statement reads supplier payments and remittances', () => {
  it('names the supplier, rate and certificate on each s.153 deduction, and lists the challans', async () => {
    const res = await call('GET', '/v1/reports/withholding-tax?date_from=2039-03-01&date_to=2039-04-30', ownerToken);
    expect(res.statusCode, res.body).toBe(200);
    const report = dataOf(res);
    const s153 = report.sections.find((s: { section: string }) => s.section === 'S153');
    const row = s153.rows.find((r: { certificate_number: string | null }) => r.certificate_number === 'CERT-TR-1');
    expect(row).toMatchObject({ rate_pct: 4 });
    expect(row.counterparty).toMatch(/^TR Supplier/);
    expect(s153.remittances.map((r: { challan_number: string }) => r.challan_number)).toContain('CPR-2039-0001');
    // Every section closes, and its rows add up to what it says was withheld.
    for (const s of report.sections) {
      expect(s.closing_balance_pkr).toBeCloseTo(s.opening_balance_pkr + s.withheld_pkr - s.remitted_pkr, 2);
      expect(s.rows.reduce((t: number, r: { withheld_pkr: number }) => t + r.withheld_pkr, 0)).toBeCloseTo(s.withheld_pkr, 2);
    }
  });
});
