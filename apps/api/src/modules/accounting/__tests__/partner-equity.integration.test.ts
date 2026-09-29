/**
 * Equity for an entity with more than one owner (IFRS for SMEs 6.2/6.3, 4.13).
 *
 * The facility is an AOP whose two owners contribute and withdraw separately, in
 * different amounts. What each equity account IS comes from the partners table —
 * a partner's capital and drawings accounts are the ones their row names — never
 * from the account's normal balance (docs/25 L-22). The inference this replaced
 * treated the opening-balance plug as an owner's capital and counted every
 * opening-balance entry to it as "capital introduced".
 *
 * The statement of changes in equity is the one roll-forward (L-24): the P&L no
 * longer carries a second one, so what its equity block used to assert — both
 * owners' drawings, capital introduced, a foot — is asserted here.
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

// A year of its own, so no other suite's postings land inside the window. It
// crosses the July fiscal-year end, so the transfer row is exercised too.
const FROM = '2044-01-01';
const TO = '2044-12-31';

let app: FastifyInstance;
let token: string;
let userId: string;
const entryIds: string[] = [];
const partners: Record<'A' | 'B', { id: string; capital: string; drawings: string }> = {} as never;

/**
 * A balanced two-line entry, posted straight in: this is fixture, not the thing
 * under test. `owner_equity` is the legacy owner-movement source — posted before
 * owner movements became documents — so it counts as capital in / drawings.
 */
async function post(date: string, sourceTable: 'owner_equity' | 'manual', lines: [string, number, number][]) {
  const d = new Date(`${date}T00:00:00.000Z`);
  const id = randomUUID();
  await prisma.journalEntry.create({
    data: {
      id,
      facilityId: TEST_FACILITY_ID,
      entryNumber: `PEQ-${id.slice(0, 8)}`,
      entryDate: d,
      entryType: 'ADJUSTMENT',
      bookType: 'PACCI',
      sourceTable,
      sourceId: id,
      description: 'partner equity fixture',
      postingStatus: 'POSTED',
      periodYear: d.getUTCFullYear(),
      periodMonth: d.getUTCMonth() + 1,
      createdBy: userId,
      lines: {
        create: lines.map(([accountCode, debitAmount, creditAmount], i) => ({
          lineNumber: i + 1,
          facilityId: TEST_FACILITY_ID,
          accountCode,
          debitAmount,
          creditAmount,
        })),
      },
    },
  });
  entryIds.push(id);
}

const equity = async (from = FROM, to = TO) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/accounting/changes-in-equity?date_from=${from}&date_to=${to}`,
      headers: authHeaders(token),
    })
  ).json().data;

beforeAll(async () => {
  app = await getTestApp();
  const login = await loginAsRole(app, 'OWNER');
  token = login.accessToken;
  userId = login.user.id;

  // Each owner added the way an owner adds them: the partner row and their two
  // accounts in one step. Nothing seeds these.
  for (const key of ['A', 'B'] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/partners',
      headers: authHeaders(token),
      payload: { name: `Equity Owner ${key} ${Date.now()}`, admitted_on: FROM },
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = await prisma.partner.findUniqueOrThrow({ where: { id: res.json().data.id } });
    partners[key] = { id: row.id, capital: row.capitalAccountCode, drawings: row.drawingsAccountCode };
  }

  // Owner A puts in 500,000; Owner B puts in 300,000 — different amounts, which
  // is the whole reason they cannot share one account.
  await post('2044-02-01', 'owner_equity', [['1010', 500000, 0], [partners.A.capital, 0, 500000]]);
  await post('2044-02-01', 'owner_equity', [['1010', 300000, 0], [partners.B.capital, 0, 300000]]);
  // And each takes a different amount out.
  await post('2044-06-01', 'owner_equity', [[partners.A.drawings, 40000, 0], ['1010', 0, 40000]]);
  await post('2044-06-01', 'owner_equity', [[partners.B.drawings, 25000, 0], ['1010', 0, 25000]]);
  // Opening equity booked to the plug: belongs to nobody, and is not capital
  // anybody introduced.
  await post('2044-03-01', 'manual', [['1010', 100000, 0], ['3010', 0, 100000]]);
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });
    const ids = Object.values(partners).map((p) => p.id);
    const codes = Object.values(partners).flatMap((p) => [p.capital, p.drawings]);
    await prisma.partnerProfitShare.deleteMany({ where: { partnerId: { in: ids } } });
    await prisma.partner.deleteMany({ where: { id: { in: ids } } });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: { in: codes } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

type Column = {
  account_code: string;
  role: string;
  partner_id: string | null;
  capital_introduced_pkr: number;
  drawings_pkr: number;
  other_movements_pkr: number;
};

describe('statement of changes in equity reads the partners table (L-22)', () => {
  const col = (d: { columns: Column[] }, code: string) => d.columns.find((c) => c.account_code === code)!;

  it('gives each owner their own columns, named for them', async () => {
    const d = await equity();
    for (const key of ['A', 'B'] as const) {
      expect(col(d, partners[key].capital)).toMatchObject({ role: 'PARTNER_CAPITAL', partner_id: partners[key].id });
      expect(col(d, partners[key].drawings)).toMatchObject({ role: 'PARTNER_DRAWINGS', partner_id: partners[key].id });
    }
  });

  it('keeps the two owners apart — B is not folded into A', async () => {
    const d = await equity();
    expect(col(d, partners.A.capital).capital_introduced_pkr).toBe(500000);
    expect(col(d, partners.B.capital).capital_introduced_pkr).toBe(300000);
    // Drawings are a debit to a contra-equity account, so the movement is negative.
    expect(col(d, partners.A.drawings).drawings_pkr).toBe(-40000);
    expect(col(d, partners.B.drawings).drawings_pkr).toBe(-25000);
    expect(d.total_capital_introduced_pkr).toBe(800000);
    expect(d.total_drawings_pkr).toBe(-65000);
  });

  it('does not count opening equity in the plug as capital anybody introduced', async () => {
    const d = await equity();
    const plug = col(d, '3010');
    expect(plug.role).toBe('OPENING_BALANCE_EQUITY');
    expect(plug.capital_introduced_pkr).toBe(0);
    expect(plug.other_movements_pkr).toBe(100000);
  });

  it('foots: every column closes at opening plus its movements', async () => {
    const d = await equity();
    for (const c of d.columns) {
      const expected =
        Math.round(
          (c.opening_pkr + c.capital_introduced_pkr + c.drawings_pkr + c.other_movements_pkr + c.result_pkr + c.transfer_pkr) * 100,
        ) / 100;
      expect(expected, `column ${c.account_code} does not foot`).toBe(c.closing_pkr);
    }
  });

  it('reconciles to the balance sheet at the same date', async () => {
    const d = await equity();
    expect(d.is_reconciled).toBe(true);
    const bs = (
      await app.inject({
        method: 'GET',
        url: `/v1/accounting/balance-sheet?as_of_date=${TO}`,
        headers: authHeaders(token),
      })
    ).json().data;
    expect(d.total_closing_pkr).toBeCloseTo(bs.total_equity_pkr, 2);
  });

  it('gives no owner a share of the result inside their own columns', async () => {
    const d = await equity();
    for (const c of d.columns) {
      if (c.role === 'CURRENT_YEAR_RESULT') continue;
      expect(c.result_pkr, `${c.account_code} was allocated a share of profit`).toBe(0);
    }
  });
});

describe('the balance sheet labels each equity line by what it is', () => {
  it('names the owner of each capital and drawings line, and the plug as the plug', async () => {
    const bs = (
      await app.inject({
        method: 'GET',
        url: `/v1/accounting/balance-sheet?as_of_date=${TO}`,
        headers: authHeaders(token),
      })
    ).json().data;
    const line = (code: string) => bs.equity_lines.find((l: { account_code: string }) => l.account_code === code);
    expect(line(partners.A.capital)).toMatchObject({ role: 'PARTNER_CAPITAL', partner_id: partners.A.id, amount_pkr: 500000 });
    expect(line(partners.B.drawings)).toMatchObject({ role: 'PARTNER_DRAWINGS', partner_id: partners.B.id, amount_pkr: -25000 });
    expect(line('3010')).toMatchObject({ role: 'OPENING_BALANCE_EQUITY', partner_id: null });
  });
});
