/**
 * Cash ↔ bank transfers (JE-27) — backlog P1-10.
 *
 * Depositing the day's takings into the bank had no first-class path: 1010
 * grew forever and 1020 never showed a deposit. Only the reverse direction
 * existed, buried in the expenses module as petty-cash replenishment.
 *
 * The property worth asserting beyond "it posts two lines" is that a transfer
 * changes where the money is and not how much there is — cash and cash
 * equivalents are unmoved, and the cash flow statement's net change is
 * unmoved with them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
const createdEntryIds: string[] = [];

const DATE = '2033-04-10';
const AMOUNT = 7500;

async function cashFlowNetChange() {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/accounting/cash-flow?date_from=2033-01-01&date_to=2033-12-31',
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as { net_change_pkr: number; closing_cash_pkr: number };
}

async function transfer(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/accounting/cash-transfers',
    headers: authHeaders(ownerToken),
    payload,
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: createdEntryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a transfer moves money between the facility\'s own accounts', () => {
  it('posts DR destination / CR source and nothing else', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1020',
      amount_pkr: AMOUNT,
      note: 'daily takings deposited',
    });
    expect(res.statusCode, res.body).toBe(201);
    const entry = JSON.parse(res.body).data;
    createdEntryIds.push(entry.id);

    const lines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: entry.id },
      orderBy: { lineNumber: 'asc' },
    });
    expect(lines).toHaveLength(2);
    expect(Number(lines.find((l) => l.accountCode === '1020')!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === '1010')!.creditAmount)).toBeCloseTo(AMOUNT, 2);
  });

  it('works in the other direction too — the gap was one-way before', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1020',
      to_account_code: '1010',
      amount_pkr: 250,
    });
    expect(res.statusCode, res.body).toBe(201);
    const entry = JSON.parse(res.body).data;
    createdEntryIds.push(entry.id);

    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: entry.id } });
    expect(Number(lines.find((l) => l.accountCode === '1010')!.debitAmount)).toBeCloseTo(250, 2);
    expect(Number(lines.find((l) => l.accountCode === '1020')!.creditAmount)).toBeCloseTo(250, 2);
  });

  it('leaves total cash — and the cash flow statement — unchanged', async () => {
    const before = await cashFlowNetChange();
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1030',
      amount_pkr: 1200,
    });
    expect(res.statusCode, res.body).toBe(201);
    createdEntryIds.push(JSON.parse(res.body).data.id);

    const after = await cashFlowNetChange();
    expect(after.closing_cash_pkr, 'a transfer changes where the money is, not how much').toBeCloseTo(
      before.closing_cash_pkr,
      2,
    );
    expect(after.net_change_pkr, 'moving between your own pockets is not a cash flow').toBeCloseTo(
      before.net_change_pkr,
      2,
    );
  });

  it('refuses an account that is not cash or bank', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1110',
      amount_pkr: 100,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('to_account_code');
  });

  it('refuses a transfer to the same account', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1010',
      amount_pkr: 100,
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a zero or negative amount', async () => {
    for (const amount_pkr of [0, -50]) {
      const res = await transfer({
        transfer_date: DATE,
        from_account_code: '1010',
        to_account_code: '1020',
        amount_pkr,
      });
      expect(res.statusCode, `amount ${amount_pkr}`).toBe(400);
    }
  });
});

describe('the facility scope holds', () => {
  it('stamps the transfer against this facility', async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { id: { in: createdEntryIds } },
      select: { facilityId: true, sourceTable: true, entryType: true },
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.facilityId).toBe(TEST_FACILITY_ID);
      expect(e.sourceTable).toBe('cash_transfer');
      expect(e.entryType).toBe('ADJUSTMENT');
    }
  });
});
