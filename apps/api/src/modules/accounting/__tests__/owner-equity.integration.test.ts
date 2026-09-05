/**
 * Owner capital and drawings (JE-30).
 *
 * The owners intend to take a regular monthly amount plus more out of profits
 * when they want it. In an association of persons none of that is an expense: a
 * member cannot be an employee of the association, so what they take is an
 * appropriation of profit. Income Tax Ordinance 2001 s.21(j) says so outright —
 * no deduction for "any profit on debt, brokerage, commission, salary or other
 * remuneration paid by an association of persons to a member of the
 * association".
 *
 * The first test in the second block is the one that matters: **an owner's
 * withdrawal must not move net profit.** That is s.21(j) written as an
 * assertion, and it fails the moment anyone routes owner pay through an expense
 * account — which was the easy mistake to make, because payroll posts every line
 * to 6010 with no owner concept in EmployeeType.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

const CAPITAL = '3071';
const DRAWINGS = '3076';
const OWNED_CODES = [CAPITAL, DRAWINGS];

// Its own year, so no other suite's postings fall inside the window.
const FROM = '2046-01-01';
const TO = '2046-12-31';

let app: FastifyInstance;
let token: string;

const post = (body: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/accounting/owner-equity',
    headers: authHeaders(token),
    payload: body,
  });

const pl = async () =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/accounting/profit-loss?date_from=${FROM}&date_to=${TO}`,
      headers: authHeaders(token),
    })
  ).json().data;

const equity = async () =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/accounting/changes-in-equity?date_from=${FROM}&date_to=${TO}`,
      headers: authHeaders(token),
    })
  ).json().data;

beforeAll(async () => {
  app = await getTestApp();
  token = (await loginAsRole(app, 'OWNER')).accessToken;

  for (const [code, name, normal] of [
    [CAPITAL, 'Owner C — Capital', 'CREDIT'],
    [DRAWINGS, 'Owner C — Drawings', 'DEBIT'],
  ] as const) {
    await prisma.chartOfAccounts.upsert({
      where: { facilityId_accountCode: { facilityId: TEST_FACILITY_ID, accountCode: code } },
      create: {
        facilityId: TEST_FACILITY_ID,
        accountCode: code,
        accountName: name,
        accountClass: 'EQUITY',
        accountType: 'DETAIL',
        normalBalance: normal,
        isActive: true,
      },
      update: { accountName: name, normalBalance: normal, isActive: true },
    });
  }
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const ids = (
      await prisma.journalEntry.findMany({
        where: { facilityId: TEST_FACILITY_ID, sourceTable: 'owner_equity' },
        select: { id: true },
      })
    ).map((e) => e.id);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: { in: OWNED_CODES } },
    });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('recording what an owner puts in and takes out', () => {
  it('books a withdrawal as DR drawings / CR bank', async () => {
    const res = await post({
      movement_date: '2046-03-01',
      direction: 'DRAWING',
      equity_account_code: DRAWINGS,
      cash_account_code: '1020',
      amount_pkr: 60000,
      note: 'March monthly withdrawal',
    });
    expect(res.statusCode).toBe(201);
    const lines = res.json().data.lines as {
      account_code: string;
      debit_amount: string | number;
      credit_amount: string | number;
    }[];
    const drawing = lines.find((l) => l.account_code === DRAWINGS)!;
    const bank = lines.find((l) => l.account_code === '1020')!;
    expect(Number(drawing.debit_amount)).toBe(60000);
    expect(Number(bank.credit_amount)).toBe(60000);
  });

  it('books capital introduced the other way round', async () => {
    const res = await post({
      movement_date: '2046-02-01',
      direction: 'CAPITAL_IN',
      equity_account_code: CAPITAL,
      cash_account_code: '1020',
      amount_pkr: 400000,
    });
    expect(res.statusCode).toBe(201);
    const lines = res.json().data.lines as {
      account_code: string;
      debit_amount: string | number;
      credit_amount: string | number;
    }[];
    expect(Number(lines.find((l) => l.account_code === '1020')!.debit_amount)).toBe(400000);
    expect(Number(lines.find((l) => l.account_code === CAPITAL)!.credit_amount)).toBe(400000);
  });

  it('treats an extra withdrawal out of profits exactly like the monthly one', async () => {
    // Regular or ad-hoc, it is the same appropriation — only the note differs.
    const res = await post({
      movement_date: '2046-04-15',
      direction: 'DRAWING',
      equity_account_code: DRAWINGS,
      cash_account_code: '1020',
      amount_pkr: 150000,
      note: 'Extra taken from profits',
    });
    expect(res.statusCode).toBe(201);
    const d = await equity();
    const col = d.columns.find((c: { account_code: string }) => c.account_code === DRAWINGS);
    expect(col.drawings_pkr).toBe(-210000); // 60,000 monthly + 150,000 extra
  });

  it('shows each movement in the owner’s own column', async () => {
    const d = await equity();
    const col = (code: string) =>
      d.columns.find((c: { account_code: string }) => c.account_code === code);
    expect(col(CAPITAL).capital_introduced_pkr).toBe(400000);
    expect(col(DRAWINGS).drawings_pkr).toBe(-210000);
    expect(d.is_reconciled).toBe(true);
  });
});

describe('an owner’s pay is not a business cost (ITO 2001 s.21(j))', () => {
  it('does NOT change net profit, however regular the withdrawal', async () => {
    // The assertion this whole feature exists for. Route owner pay through
    // payroll or an expense voucher and 6010 moves, profit falls, every margin
    // is wrong, and taxable income is understated.
    const before = (await pl()).net_profit_pkr;
    const res = await post({
      movement_date: '2046-05-01',
      direction: 'DRAWING',
      equity_account_code: DRAWINGS,
      cash_account_code: '1020',
      amount_pkr: 60000,
      note: 'May monthly withdrawal',
    });
    expect(res.statusCode).toBe(201);
    expect((await pl()).net_profit_pkr).toBe(before);
  });

  it('refuses to book it against an expense account', async () => {
    const res = await post({
      movement_date: '2046-05-02',
      direction: 'DRAWING',
      equity_account_code: '6010', // Salaries — Management & Office
      cash_account_code: '1020',
      amount_pkr: 60000,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('equity account');
  });

  it('refuses the accounts the statements work out for themselves', async () => {
    for (const code of ['3020', '3030']) {
      const res = await post({
        movement_date: '2046-05-03',
        direction: 'CAPITAL_IN',
        equity_account_code: code,
        cash_account_code: '1020',
        amount_pkr: 1000,
      });
      expect(res.statusCode, `${code} should be refused`).toBe(400);
    }
  });

  it('refuses a cash side that is not cash or bank', async () => {
    const res = await post({
      movement_date: '2046-05-04',
      direction: 'DRAWING',
      equity_account_code: DRAWINGS,
      cash_account_code: '1120', // Receivable — Traders
      amount_pkr: 1000,
    });
    expect(res.statusCode).toBe(400);
  });
});
