/**
 * Equity for an entity with more than one owner.
 *
 * The facility is an AOP whose two owners contribute and withdraw separately,
 * in different amounts. Phase 29 built the equity presentation for a single
 * owner: one seeded capital account, one seeded drawings account, and the
 * combined statement of income and retained earnings that IFRS for SMEs 6.4
 * permits.
 *
 * Two things follow, and both are asserted here rather than argued:
 *
 *   1. 6.4's permission is conditional — the sole equity movements must be
 *      profit or loss, distributions, error corrections and policy changes.
 *      Capital introduced is not among them, so the moment an owner puts money
 *      in, that statement may not be presented and the statement of changes in
 *      equity (6.2/6.3) is required. `combined_statement_permitted` is the
 *      standard's own test, and the P&L block hides on it.
 *
 *   2. 4.13 requires an entity without share capital to show the changes in
 *      *each* category of equity. Each equity account is a category, so a
 *      second owner's accounts must appear without any code knowing their
 *      codes — which is why drawings are derived from being DEBIT-normal
 *      rather than from the literal '3015' the seed ships.
 *
 * Before this file, `equityRollforward` read one hardcoded code and had no test
 * at all, and the rollforward could not foot once capital was introduced.
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

// Owner B's pair, in the equity range but clear of everything the seed ships.
const B_CAPITAL = '3061';
const B_DRAWINGS = '3066';
const OWNED_CODES = [B_CAPITAL, B_DRAWINGS];

// A year of its own, so no other suite's postings land inside the window.
const FROM = '2044-01-01';
const TO = '2044-12-31';
const ENTRY_PREFIX = 'PEQ-';

let app: FastifyInstance;
let token: string;

/** A balanced two-line entry, posted straight in — this is fixture, not the thing under test. */
async function post(entryNumber: string, date: string, lines: [string, number, number][]) {
  const d = new Date(date);
  const user = await prisma.user.findFirstOrThrow({
    where: { facilityId: TEST_FACILITY_ID },
    select: { id: true },
  });
  await prisma.journalEntry.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      entryNumber,
      entryDate: d,
      entryType: 'ADJUSTMENT',
      bookType: 'PACCI',
      sourceTable: 'manual',
      sourceId: TEST_FACILITY_ID,
      description: `partner equity fixture ${entryNumber}`,
      postingStatus: 'POSTED',
      periodYear: d.getUTCFullYear(),
      periodMonth: d.getUTCMonth() + 1,
      createdBy: user.id,
      lines: {
        create: lines.map(([accountCode, debitAmount, creditAmount], i) => ({
          lineNumber: i + 1,
          facilityId: TEST_FACILITY_ID,
          accountCode,
          debitAmount,
          creditAmount,
          description: 'partner equity fixture',
        })),
      },
    },
  });
}

const equity = async (from = FROM, to = TO) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/accounting/changes-in-equity?date_from=${from}&date_to=${to}`,
      headers: authHeaders(token),
    })
  ).json().data;

const pl = async (from = FROM, to = TO) =>
  (
    await app.inject({
      method: 'GET',
      url: `/v1/accounting/profit-loss?date_from=${from}&date_to=${to}`,
      headers: authHeaders(token),
    })
  ).json().data;

beforeAll(async () => {
  app = await getTestApp();
  token = (await loginAsRole(app, 'OWNER')).accessToken;

  // Owner B's own capital and drawings accounts, created the way an owner
  // creates them — nothing seeds these, and nothing may need to.
  for (const [code, name, normal] of [
    [B_CAPITAL, 'Owner B — Capital', 'CREDIT'],
    [B_DRAWINGS, 'Owner B — Drawings', 'DEBIT'],
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

  // Owner A puts in 500,000; Owner B puts in 300,000 — different amounts, which
  // is the whole reason they cannot share one account.
  await post(`${ENTRY_PREFIX}A-CAP`, '2044-02-01', [['1010', 500000, 0], ['3010', 0, 500000]]);
  await post(`${ENTRY_PREFIX}B-CAP`, '2044-02-01', [['1010', 300000, 0], [B_CAPITAL, 0, 300000]]);
  // And each takes a different amount out.
  await post(`${ENTRY_PREFIX}A-DRW`, '2044-06-01', [['3015', 40000, 0], ['1010', 0, 40000]]);
  await post(`${ENTRY_PREFIX}B-DRW`, '2044-06-01', [[B_DRAWINGS, 25000, 0], ['1010', 0, 25000]]);
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const ids = (
      await prisma.journalEntry.findMany({
        where: { facilityId: TEST_FACILITY_ID, entryNumber: { startsWith: ENTRY_PREFIX } },
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

describe('statement of changes in equity (IFRS for SMEs 6.2/6.3, 4.13)', () => {
  it('gives each owner their own column — both capital accounts and both drawings accounts', async () => {
    const d = await equity();
    const codes = d.columns.map((c: { account_code: string }) => c.account_code);
    expect(codes).toContain('3010');
    expect(codes).toContain(B_CAPITAL);
    expect(codes).toContain('3015');
    expect(codes).toContain(B_DRAWINGS);
  });

  it('keeps the two owners apart — B is not folded into A', async () => {
    const d = await equity();
    const col = (code: string) =>
      d.columns.find((c: { account_code: string }) => c.account_code === code);
    expect(col('3010').capital_introduced_pkr).toBe(500000);
    expect(col(B_CAPITAL).capital_introduced_pkr).toBe(300000);
    // Drawings are a debit to a contra-equity account, so the movement is negative.
    expect(col('3015').drawings_pkr).toBe(-40000);
    expect(col(B_DRAWINGS).drawings_pkr).toBe(-25000);
  });

  it('foots: every column closes at opening plus its movements', async () => {
    const d = await equity();
    for (const c of d.columns) {
      const expected =
        Math.round(
          (c.opening_pkr + c.capital_introduced_pkr + c.drawings_pkr + c.result_pkr) * 100,
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

  it('does not invent a profit split, because no agreement says what it is', async () => {
    const d = await equity();
    expect(d.result_is_unallocated).toBe(true);
    // The result belongs to no owner's column — it sits undivided.
    for (const c of d.columns) {
      if (c.account_code === '3020' || c.account_code === '3030') continue;
      expect(c.result_pkr, `${c.account_code} was allocated a share of profit`).toBe(0);
    }
  });
});

describe('the P&L block obeys IFRS for SMEs 6.4 rather than assuming it applies', () => {
  it('counts BOTH owners drawings, not just the seeded account', async () => {
    // Against the shipped code this read -40000: '3015' was hardcoded, so owner
    // B's 25,000 vanished from the face of the statement.
    const d = await pl();
    expect(d.drawings_pkr).toBe(65000);
  });

  it('discloses capital introduced, so the rollforward can foot', async () => {
    const d = await pl();
    expect(d.capital_introduced_pkr).toBe(800000);
    const rolled =
      Math.round(
        (d.opening_equity_pkr + d.capital_introduced_pkr + d.net_profit_pkr - d.drawings_pkr) * 100,
      ) / 100;
    expect(rolled).toBeCloseTo(d.closing_equity_pkr, 2);
  });

  it('withdraws the combined statement once capital has been introduced', async () => {
    // 6.4 permits it only where equity moved solely through profit or loss,
    // distributions, error corrections and policy changes.
    const d = await pl();
    expect(d.combined_statement_permitted).toBe(false);
  });

  it('permits it again over a period with no capital introduced', async () => {
    const d = await pl('2044-07-01', '2044-12-31');
    expect(d.capital_introduced_pkr).toBe(0);
    expect(d.combined_statement_permitted).toBe(true);
  });
});
