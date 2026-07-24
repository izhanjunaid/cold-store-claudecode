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
let testPartyId: string;

async function cleanup() {
  await withGuardsDisabled(prisma, cleanupInner);
}

async function cleanupInner() {
  await prisma.partyLoanRepayment.deleteMany({
    where: { loan: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.partyLoan.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { issueJournalEntryId: null, writeOffJournalEntryId: null },
  });
  await prisma.partyLoan.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.journalEntryLine.deleteMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      journalEntry: {
        OR: [
          { sourceTable: 'party_loans' },
          { sourceTable: 'party_loan_repayments' },
        ],
      },
    },
  });
  await prisma.journalEntry.deleteMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      OR: [
        { sourceTable: 'party_loans' },
        { sourceTable: 'party_loan_repayments' },
      ],
    },
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

  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: `Peshgi-Farmer-${Date.now()}`,
      party_type: 'FARMER',
      phone_primary: `0300${Date.now()}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  testPartyId = JSON.parse(partyRes.body).data.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

async function issueLoan(amount = 50000, date = '2026-04-10', method: 'CASH' | 'BANK_TRANSFER' = 'CASH') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/loans/issue',
    headers: authHeaders(ownerToken),
    payload: {
      party_id: testPartyId,
      issue_date: date,
      principal_pkr: amount,
      payment_method: method,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

describe('Phase 9 — Peshgi (Loans) realigned API', () => {
  it('issues a loan with L-YYMMDD-NNN format and posts JE-18', async () => {
    await cleanup();
    const loan = await issueLoan(50000, '2026-04-10');
    expect(loan.loan_number).toMatch(/^L-260410-\d{3}$/);
    expect(loan.principal_pkr).toBe(50000);
    expect(loan.balance_outstanding_pkr).toBe(50000);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.issue_journal_entry_id).toBeTruthy();
    expect(loan.source_asset_account_code).toBe('1010');

    const je = await prisma.journalEntry.findUnique({
      where: { id: loan.issue_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PESHGI_ISSUE');
    expect(je?.lines.find((l) => l.accountCode === '1140')?.debitAmount.toString()).toBe('50000');
    expect(je?.lines.find((l) => l.accountCode === '1010')?.creditAmount.toString()).toBe('50000');
  });

  it('BANK_TRANSFER routes to source account 1020', async () => {
    await cleanup();
    const loan = await issueLoan(20000, '2026-04-11', 'BANK_TRANSFER');
    expect(loan.source_asset_account_code).toBe('1020');
  });

  it('OPERATOR cannot issue a loan (OWNER-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/loans/issue',
      headers: authHeaders(operatorToken),
      payload: {
        party_id: testPartyId,
        issue_date: '2026-04-15',
        principal_pkr: 1000,
        payment_method: 'CASH',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('records partial repayment via MANAGER and reduces balance', async () => {
    await cleanup();
    const loan = await issueLoan(50000);

    const rep = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 20000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(201);
    const updated = JSON.parse(rep.body).data;
    expect(updated.balance_outstanding_pkr).toBe(30000);
    expect(updated.status).toBe('ACTIVE');
    expect(updated.repayments.length).toBe(1);
    expect(updated.repayments[0].journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: updated.repayments[0].journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PESHGI_RECOVERY');
    expect(je?.lines.find((l) => l.accountCode === '1010')?.debitAmount.toString()).toBe('20000');
    expect(je?.lines.find((l) => l.accountCode === '1140')?.creditAmount.toString()).toBe('20000');
  });

  it('ACCOUNTANT cannot record repayment (MANAGER+ only)', async () => {
    await cleanup();
    const loan = await issueLoan(50000);
    const rep = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 10000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(403);
  });

  it('full repayment moves loan to RECOVERED (renamed from FULLY_RECOVERED)', async () => {
    await cleanup();
    const loan = await issueLoan(50000);
    const rep = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 50000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(201);
    const updated = JSON.parse(rep.body).data;
    expect(updated.balance_outstanding_pkr).toBe(0);
    expect(updated.status).toBe('RECOVERED');
  });

  it('cannot record repayment exceeding outstanding balance', async () => {
    await cleanup();
    const loan = await issueLoan(50000);
    const rep = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 60000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(422);
    expect(JSON.parse(rep.body).error.code).toBe('PESHGI_OVER_REPAYMENT');
  });

  it('cannot record repayment on a recovered loan', async () => {
    await cleanup();
    const loan = await issueLoan(10000);
    await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-05-01',
        amount_pkr: 10000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-05-15',
        amount_pkr: 100,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('PESHGI_INACTIVE');
  });

  it('write-off posts JE-20 (DR 6080 / CR 1140) and marks loan WRITTEN_OFF', async () => {
    await cleanup();
    const loan = await issueLoan(30000);

    const wo = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Bad debt — farmer relocated' },
    });
    expect(wo.statusCode).toBe(200);
    const data = JSON.parse(wo.body).data;
    expect(data.status).toBe('WRITTEN_OFF');
    expect(data.balance_outstanding_pkr).toBe(0);
    expect(data.write_off_journal_entry_id).toBeTruthy();
    expect(data.write_off_reason).toBe('Bad debt — farmer relocated');

    const je = await prisma.journalEntry.findUnique({
      where: { id: data.write_off_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PESHGI_WRITE_OFF');
    expect(je?.lines.find((l) => l.accountCode === '6080')?.debitAmount.toString()).toBe('30000');
    expect(je?.lines.find((l) => l.accountCode === '1140')?.creditAmount.toString()).toBe('30000');
  });

  it('write-off rejected for non-OWNER', async () => {
    await cleanup();
    const loan = await issueLoan(30000);
    const wo = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/write-off`,
      headers: authHeaders(managerToken),
      payload: { reason: 'attempting unauthorized write-off' },
    });
    expect(wo.statusCode).toBe(403);
  });

  it('write-off rejected on already RECOVERED loan', async () => {
    await cleanup();
    const loan = await issueLoan(10000);
    await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-05-01',
        amount_pkr: 10000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    const wo = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/write-off`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'too late' },
    });
    expect(wo.statusCode).toBe(409);
    expect(JSON.parse(wo.body).error.code).toBe('PESHGI_ALREADY_CLOSED');
  });

  it('rejects loan issuance when period locked', async () => {
    await cleanup();
    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 8, reason: 'test' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/loans/issue',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: testPartyId,
        issue_date: '2026-08-15',
        principal_pkr: 5000,
        payment_method: 'CASH',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');

    await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2026/8/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'cleanup' },
    });
  });

  it('lists loans filtered by party_id and status', async () => {
    await cleanup();
    await issueLoan(10000);
    const list = await app.inject({
      method: 'GET',
      url: `/v1/loans?party_id=${testPartyId}&status=ACTIVE`,
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.success).toBe(true);
    expect(body.data.every((l: any) => l.party_id === testPartyId && l.status === 'ACTIVE')).toBe(true);
  });

  it('GET /v1/loans/:id/acknowledgment returns JSON (PDF deferred)', async () => {
    await cleanup();
    const loan = await issueLoan(15000);
    const ack = await app.inject({
      method: 'GET',
      url: `/v1/loans/${loan.id}/acknowledgment`,
      headers: authHeaders(accountantToken),
    });
    expect(ack.statusCode).toBe(200);
    const body = JSON.parse(ack.body);
    expect(body.data.format).toBe('json');
    expect(body.data.loan_number).toBe(loan.loan_number);
    expect(body.data.principal_pkr).toBe(15000);
  });
});

describe('Phase 19 — produce-deduction repayments must be journalled', () => {
  it('rejects a standalone DEDUCTED_FROM_PRODUCE repayment (no cash side, no JE)', async () => {
    await cleanup();
    const loan = await issueLoan(30000, '2026-05-01');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 10000,
        payment_method: 'DEDUCTED_FROM_PRODUCE',
      },
    });
    // Rejected at the schema boundary — the endpoint only accepts CASH/BANK_TRANSFER,
    // both of which post JE-19. Produce deductions flow through combined settlement.
    expect(res.statusCode).toBe(400);
  });

  it('rejects a CASH repayment with no asset_account_code', async () => {
    await cleanup();
    const loan = await issueLoan(30000, '2026-05-02');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: { repayment_date: '2026-06-02', amount_pkr: 10000, payment_method: 'CASH' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('keeps GL 1140 in lockstep with the loan subledger', async () => {
    await cleanup();
    const loan = await issueLoan(40000, '2026-05-03');
    const rep = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-06-03',
        amount_pkr: 15000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(201);
    const updated = JSON.parse(rep.body).data;

    // GL 1140 net (debit − credit) must equal the outstanding loan balance.
    const agg = await prisma.journalEntryLine.aggregate({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '1140', journalEntry: { postingStatus: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const glBalance = Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0);
    expect(glBalance).toBeCloseTo(updated.balance_outstanding_pkr);
    expect(glBalance).toBeCloseTo(25000);
  });
});
