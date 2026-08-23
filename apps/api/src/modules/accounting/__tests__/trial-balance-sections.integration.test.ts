/**
 * The trial balance groups by statement section as well as by account class.
 *
 * Grouping by class alone meant the trial balance and the statements presented
 * two incompatible pictures of one ledger, with no way to trace a trial-balance
 * subtotal onto the face of the P&L or balance sheet. That is the most literal
 * reading of the original complaint that the system "mixes various accounting
 * standards".
 *
 * The assertion that makes it worth having is the reconciliation: every row
 * lands in exactly one group of each kind, so the two sets of subtotals must
 * sum to the same grand total. Adding a second view that can disagree with the
 * first would make the problem worse, not better.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders } from '../../../test/helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let ownerToken: string;

type Sub = {
  opening_debit_pkr: number;
  opening_credit_pkr: number;
  movement_debit_pkr: number;
  movement_credit_pkr: number;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
};
type Group = { rows: { account_code: string; statement_section: string }[]; subtotal: Sub };

async function trialBalance() {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/accounting/trial-balance?date_from=2020-01-01&date_to=2035-12-31',
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data;
}

const sumOf = (groups: Group[], key: keyof Sub) =>
  Math.round(groups.reduce((s, g) => s + g.subtotal[key], 0) * 100) / 100;

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await closeTestApp();
});

describe('the trial balance can be read by section as well as by class', () => {
  it('returns both groupings over the same rows', async () => {
    const tb = await trialBalance();
    expect(Array.isArray(tb.groups)).toBe(true);
    expect(Array.isArray(tb.section_groups)).toBe(true);

    const classRows = tb.groups.flatMap((g: Group) => g.rows.map((r) => r.account_code)).sort();
    const sectionRows = tb.section_groups.flatMap((g: Group) => g.rows.map((r) => r.account_code)).sort();
    expect(sectionRows).toEqual(classRows);
  });

  it('reconciles: section subtotals sum to the same grand totals as class subtotals', async () => {
    const tb = await trialBalance();
    const keys: (keyof Sub)[] = [
      'opening_debit_pkr',
      'opening_credit_pkr',
      'movement_debit_pkr',
      'movement_credit_pkr',
      'debit_balance_pkr',
      'credit_balance_pkr',
    ];
    for (const k of keys) {
      expect(sumOf(tb.section_groups, k), `${k} must agree across both groupings`).toBeCloseTo(
        sumOf(tb.groups, k),
        2,
      );
    }
    // And still against the response's own totals, so neither view can drift
    // away from the number the statement itself reports.
    expect(sumOf(tb.section_groups, 'debit_balance_pkr')).toBeCloseTo(tb.total_debit_pkr, 2);
    expect(sumOf(tb.section_groups, 'credit_balance_pkr')).toBeCloseTo(tb.total_credit_pkr, 2);
  });

  it('places equity by class, since equity carries no statement section by design', async () => {
    const tb = await trialBalance();
    const equityRows = tb.groups
      .filter((g: { account_class: string }) => g.account_class === 'EQUITY')
      .flatMap((g: Group) => g.rows);
    // Only assert if the facility actually has equity activity.
    if (equityRows.length > 0) {
      for (const r of equityRows) {
        expect(r.statement_section, `${r.account_code} is equity`).toBe('EQUITY');
      }
      expect(tb.section_groups.some((g: { statement_section: string }) => g.statement_section === 'EQUITY')).toBe(true);
    }
  });

  it('gives every row a section — none may fall out of the sectioned view', async () => {
    const tb = await trialBalance();
    for (const g of tb.section_groups as Group[]) {
      for (const r of g.rows) {
        expect(r.statement_section, `${r.account_code} has no section`).toBeTruthy();
      }
    }
  });

  it('puts detail accounts under their parent header\'s section', async () => {
    const tb = await trialBalance();
    const rows: { account_code: string; statement_section: string }[] = tb.rows;
    // 1010 Cash on Hand sits under 1000 Cash & Bank, a CURRENT_ASSET header.
    const cash = rows.find((r) => r.account_code === '1010');
    if (cash) expect(cash.statement_section).toBe('CURRENT_ASSET');
    // 6010 Salaries sits under 6000, an OPERATING_EXPENSE header.
    const salaries = rows.find((r) => r.account_code === '6010');
    if (salaries) expect(salaries.statement_section).toBe('OPERATING_EXPENSE');
  });
});
