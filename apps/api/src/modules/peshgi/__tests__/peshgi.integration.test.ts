import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  await prisma.partyLoanRepayment.deleteMany({
    where: { loan: { facilityId: TEST_FACILITY_ID } },
  });
  await prisma.partyLoan.updateMany({
    where: { facilityId: TEST_FACILITY_ID },
    data: { issueJournalEntryId: null },
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

async function issueLoan(amount = 50000, date = '2026-04-10') {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/peshgi',
    headers: authHeaders(ownerToken),
    payload: {
      party_id: testPartyId,
      issue_date: date,
      principal_pkr: amount,
      source_asset_account_code: '1010',
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

describe('Phase 8B — Peshgi (Loans)', () => {
  it('issues a loan, posts JE-18, and sets balance equal to principal', async () => {
    await cleanup();
    const loan = await issueLoan(50000);
    expect(loan.loan_number).toMatch(/^PSH-202604-\d{4}$/);
    expect(loan.principal_pkr).toBe(50000);
    expect(loan.balance_outstanding_pkr).toBe(50000);
    expect(loan.status).toBe('ACTIVE');
    expect(loan.issue_journal_entry_id).toBeTruthy();

    const je = await prisma.journalEntry.findUnique({
      where: { id: loan.issue_journal_entry_id },
      include: { lines: true },
    });
    expect(je?.entryType).toBe('PESHGI_ISSUE');
    expect(je?.lines.find((l) => l.accountCode === '1140')?.debitAmount.toString()).toBe('50000');
    expect(je?.lines.find((l) => l.accountCode === '1010')?.creditAmount.toString()).toBe('50000');
  });

  it('OPERATOR cannot issue a loan (OWNER-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/peshgi',
      headers: authHeaders(operatorToken),
      payload: {
        party_id: testPartyId,
        issue_date: '2026-04-15',
        principal_pkr: 1000,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('records partial repayment and reduces balance', async () => {
    await cleanup();
    const loan = await issueLoan(50000);

    const rep = await app.inject({
      method: 'POST',
      url: `/v1/peshgi/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
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

  it('full repayment moves loan to FULLY_RECOVERED', async () => {
    await cleanup();
    const loan = await issueLoan(50000);

    const rep = await app.inject({
      method: 'POST',
      url: `/v1/peshgi/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
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
    expect(updated.status).toBe('FULLY_RECOVERED');
  });

  it('cannot record repayment exceeding outstanding balance', async () => {
    await cleanup();
    const loan = await issueLoan(50000);

    const rep = await app.inject({
      method: 'POST',
      url: `/v1/peshgi/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
      payload: {
        repayment_date: '2026-06-01',
        amount_pkr: 60000, // exceeds 50000 principal
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(rep.statusCode).toBe(422);
    expect(JSON.parse(rep.body).error.code).toBe('PESHGI_OVER_REPAYMENT');
  });

  it('cannot record repayment on a fully recovered loan', async () => {
    await cleanup();
    const loan = await issueLoan(10000);
    await app.inject({
      method: 'POST',
      url: `/v1/peshgi/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
      payload: {
        repayment_date: '2026-05-01',
        amount_pkr: 10000,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/peshgi/${loan.id}/repayments`,
      headers: authHeaders(accountantToken),
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
      url: '/v1/peshgi',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: testPartyId,
        issue_date: '2026-08-15',
        principal_pkr: 5000,
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
      url: `/v1/peshgi?party_id=${testPartyId}&status=ACTIVE`,
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    const body = JSON.parse(list.body);
    expect(body.success).toBe(true);
    expect(body.data.every((l: any) => l.party_id === testPartyId && l.status === 'ACTIVE')).toBe(true);
  });
});
