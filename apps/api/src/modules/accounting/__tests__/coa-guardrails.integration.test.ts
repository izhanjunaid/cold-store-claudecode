/**
 * Phase A chart-of-accounts guardrails.
 *
 * Three rules, each closing a way an account could be created wrong and then
 * stay permanently wrong — guard_chart_of_accounts locks account_code, class,
 * type, parent and normal_balance the moment the account has a posting, so
 * none of these are correctable after the fact:
 *
 *   1. a non-equity HEADER must declare its statement_section, or every
 *      detail account beneath it lands in the statements' unclassified
 *      bucket — the F-6b safety net stops being a safety net and becomes the
 *      normal path
 *   2. normal_balance is derived from the class unless the caller explicitly
 *      declares a contra account
 *   3. an account nothing has touched can be deleted outright, instead of
 *      being deactivated and haunting every account picker forever
 *
 * Rejections are asserted behaviourally — status, error code, and *the
 * account not existing afterwards* — rather than on message text, which is
 * formatted by the Zod validator compiler and is not a contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

// Codes this file mints, in the unassigned 8xxx range so they collide with
// nothing seeded and nothing another test file uses.
const OWNED_CODES = ['8110', '8120', '8130', '8140', '8150', '8160', '8170'];

let app: FastifyInstance;
let ownerToken: string;

const post = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/accounting/accounts',
    headers: authHeaders(ownerToken),
    payload,
  });

const exists = async (code: string) =>
  (await prisma.chartOfAccounts.count({
    where: { facilityId: TEST_FACILITY_ID, accountCode: code },
  })) > 0;

/**
 * One test deliberately pins an account with a posted journal entry. That
 * entry is immutable by trigger and the JE-line FK is ON DELETE RESTRICT, so
 * the account cannot be removed until the entry is gone — hence
 * withGuardsDisabled, which is global ALTER TABLE DDL across 12 tables and
 * belongs in afterAll only, never mid-test.
 */
async function cleanup() {
  const lines = await prisma.journalEntryLine.findMany({
    where: { facilityId: TEST_FACILITY_ID, accountCode: { in: OWNED_CODES } },
    select: { journalEntryId: true },
  });
  const jeIds = [...new Set(lines.map((l) => l.journalEntryId))];
  if (jeIds.length > 0) {
    await withGuardsDisabled(prisma, async () => {
      await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    });
  }
  // Children before parents — 8130 sits under 8110.
  await prisma.chartOfAccounts.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, accountCode: { in: OWNED_CODES }, accountType: 'DETAIL' },
  });
  await prisma.chartOfAccounts.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, accountCode: { in: OWNED_CODES } },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

// ============================================================
// 1 — a header must declare where its children land
// ============================================================

describe('a non-equity HEADER must declare its statement section', () => {
  it('rejects a header with no section, and creates nothing', async () => {
    const res = await post({
      account_code: '8110',
      account_name: 'Unsectioned Header (rejected)',
      account_class: 'EXPENSE',
      account_type: 'HEADER',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(await exists('8110')).toBe(false);
  });

  it('accepts the same header once the section is given', async () => {
    const res = await post({
      account_code: '8110',
      account_name: 'Sectioned Header',
      account_class: 'EXPENSE',
      account_type: 'HEADER',
      statement_section: 'OPERATING_EXPENSE',
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.statement_section).toBe('OPERATING_EXPENSE');
  });

  it('still accepts an EQUITY header without one — equity aggregates by class, not by header', async () => {
    const res = await post({
      account_code: '8120',
      account_name: 'Equity Grouping Header',
      account_class: 'EQUITY',
      account_type: 'HEADER',
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.statement_section).toBeNull();
  });

  it('leaves DETAIL accounts unaffected — they inherit placement from their parent', async () => {
    const res = await post({
      account_code: '8130',
      account_name: 'Detail Under Sectioned Header',
      account_class: 'EXPENSE',
      account_type: 'DETAIL',
      parent_account_code: '8110',
    });
    expect(res.statusCode).toBe(201);
  });
});

// ============================================================
// 2 — normal_balance is derived, not asked for
// ============================================================

describe('normal_balance derives from the account class', () => {
  it('derives DEBIT for an asset when the caller omits it', async () => {
    const res = await post({
      account_code: '8140',
      account_name: 'Derived Debit Asset',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.normal_balance).toBe('DEBIT');
  });

  it('rejects an asset declared CREDIT without is_contra, and creates nothing', async () => {
    const res = await post({
      account_code: '8150',
      account_name: 'Undeclared Contra (rejected)',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
      normal_balance: 'CREDIT',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(await exists('8150')).toBe(false);
  });

  it('accepts the same account once is_contra declares the inversion', async () => {
    const res = await post({
      account_code: '8150',
      account_name: 'Accumulated Something — contra asset',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
      normal_balance: 'CREDIT',
      is_contra: true,
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.normal_balance).toBe('CREDIT');
  });

  it('does not require is_contra when the declared balance already matches the class', async () => {
    const res = await post({
      account_code: '8160',
      account_name: 'Explicit But Matching',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
      normal_balance: 'DEBIT',
    });
    expect(res.statusCode).toBe(201);
  });
});

// ============================================================
// 3 — delete, but only what nothing has touched
// ============================================================

describe('an untouched account can be deleted outright', () => {
  const del = (code: string) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/accounting/accounts/${code}`,
      headers: authHeaders(ownerToken),
    });

  it('deletes an account with no postings, no children and nothing configured to use it', async () => {
    const created = await post({
      account_code: '8170',
      account_name: 'Mistyped, Deleted Immediately',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
    });
    expect(created.statusCode).toBe(201);

    expect((await del('8170')).statusCode).toBe(200);
    expect(await exists('8170')).toBe(false);
  });

  it('refuses a header that still has children', async () => {
    // 8130 sits under 8110.
    const res = await del('8110');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_IN_USE');
    expect(await exists('8110')).toBe(true);
  });

  it('refuses an account carrying a journal posting — history must survive', async () => {
    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(ownerToken),
      payload: {
        entry_date: new Date().toISOString().slice(0, 10),
        description: 'coa-guardrails: pin 8140 with a posting',
        lines: [
          { account_code: '8140', debit_amount: 5, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 5 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await del('8140');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_IN_USE');
    // Deactivation, not deletion, is the route for an account with history —
    // the message has to say so, or the operator just retries the delete.
    expect(JSON.parse(res.body).error.message).toMatch(/deactivate/i);
    expect(await exists('8140')).toBe(true);
  });

  it('refuses a system account', async () => {
    const res = await del('1010');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
    expect(await exists('1010')).toBe(true);
  });

  it('404s on an account that does not exist', async () => {
    const res = await del('8999');
    expect(res.statusCode).toBe(404);
  });
});
