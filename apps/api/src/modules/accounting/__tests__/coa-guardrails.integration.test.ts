/**
 * Phase A chart-of-accounts guardrails.
 *
 * Three rules, each closing a way an account could be created wrong and then
 * stay permanently wrong — guard_chart_of_accounts locks account_code, class,
 * type, parent and normal_balance the moment the account has a posting, so
 * none of these are correctable after the fact:
 *
 *   1. a non-equity HEADER must declare its statement_section, or no detail
 *      account beneath it would appear on any statement
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

// Codes this file mints — each inside its class's range (the prefix is required,
// docs/25 L-31) but clear of everything seeded and every other test file.
const OWNED_CODES = ['6800', '3800', '6810', '1291', '1292', '1293', '1294', '1295', '4310', '6820', '7050', '0150', '6850'];
let partnerId: string | null = null;

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
  await prisma.ratePlan.deleteMany({ where: { facilityId: TEST_FACILITY_ID, name: 'coa-guardrails plan' } });
  if (partnerId) {
    const p = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (p) {
      await prisma.partner.delete({ where: { id: partnerId } });
      await prisma.chartOfAccounts.deleteMany({
        where: { facilityId: TEST_FACILITY_ID, accountCode: { in: [p.capitalAccountCode, p.drawingsAccountCode] } },
      });
    }
  }
  // Children before parents — 6810 sits under 6800.
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
      account_code: '6800',
      account_name: 'Unsectioned Header (rejected)',
      account_class: 'EXPENSE',
      account_type: 'HEADER',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(await exists('6800')).toBe(false);
  });

  it('accepts the same header once the section is given', async () => {
    const res = await post({
      account_code: '6800',
      account_name: 'Sectioned Header',
      account_class: 'EXPENSE',
      account_type: 'HEADER',
      statement_section: 'OPERATING_EXPENSE',
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.statement_section).toBe('OPERATING_EXPENSE');
  });

  // The chart page offers "Non-Operating Expenses" (the database enum has it since
  // phase 25); the shared request schema had dropped it, so the API refused it.
  it('accepts a Non-Operating (OTHER_EXPENSE) expense header', async () => {
    const res = await post({
      account_code: '6850',
      account_name: 'Non-Operating Header',
      account_class: 'EXPENSE',
      account_type: 'HEADER',
      statement_section: 'OTHER_EXPENSE',
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body).data.statement_section).toBe('OTHER_EXPENSE');
  });

  it('still accepts an EQUITY header without one — equity aggregates by class, not by header', async () => {
    const res = await post({
      account_code: '3800',
      account_name: 'Equity Grouping Header',
      account_class: 'EQUITY',
      account_type: 'HEADER',
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.statement_section).toBeNull();
  });

  it('leaves DETAIL accounts unaffected — they inherit placement from their parent', async () => {
    const res = await post({
      account_code: '6810',
      account_name: 'Detail Under Sectioned Header',
      account_class: 'EXPENSE',
      account_type: 'DETAIL',
      parent_account_code: '6800',
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
      account_code: '1291',
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
      account_code: '1292',
      account_name: 'Undeclared Contra (rejected)',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
      normal_balance: 'CREDIT',
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(await exists('1292')).toBe(false);
  });

  it('accepts the same account once is_contra declares the inversion', async () => {
    const res = await post({
      account_code: '1292',
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
      account_code: '1293',
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
      account_code: '1294',
      account_name: 'Mistyped, Deleted Immediately',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1200',
    });
    expect(created.statusCode).toBe(201);

    expect((await del('1294')).statusCode).toBe(200);
    expect(await exists('1294')).toBe(false);
  });

  it('refuses a header that still has children', async () => {
    // 6810 sits under 6800.
    const res = await del('6800');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_IN_USE');
    expect(await exists('6800')).toBe(true);
  });

  it('refuses an account carrying a journal posting — history must survive', async () => {
    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(ownerToken),
      payload: {
        entry_date: new Date().toISOString().slice(0, 10),
        description: 'coa-guardrails: pin 1291 with a posting',
        lines: [
          { account_code: '1291', debit_amount: 5, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 5 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await del('1291');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_IN_USE');
    // Deactivation, not deletion, is the route for an account with history —
    // the message has to say so, or the operator just retries the delete.
    expect(JSON.parse(res.body).error.message).toMatch(/deactivate/i);
    expect(await exists('1291')).toBe(true);
  });

  it('refuses a system account', async () => {
    const res = await del('1010');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
    expect(await exists('1010')).toBe(true);
  });

  it('404s on an account that does not exist', async () => {
    const res = await del('1299');
    expect(res.statusCode).toBe(404);
  });

  it('refuses an account a partner owns, with a clean error rather than a raw foreign-key failure', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/partners',
      headers: authHeaders(ownerToken),
      payload: { name: `Guardrail Owner ${Date.now()}`, admitted_on: '2026-01-01' },
    });
    expect(created.statusCode, created.body).toBe(201);
    partnerId = created.json().data.id;
    const p = await prisma.partner.findUniqueOrThrow({ where: { id: partnerId! } });

    const res = await del(p.capitalAccountCode);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('ACCOUNT_IN_USE');
    expect(await exists(p.capitalAccountCode)).toBe(true);
  });
});

// ============================================================
// 4 — the chart's own rules (docs/25 L-31, L-34, L-38, L-19)
// ============================================================

describe('every code starts with its class digit (L-31)', () => {
  it.each([
    ['7050', 'EXPENSE', '6000'],
    ['0150', 'ASSET', '1200'],
  ])('rejects %s for %s — the unassigned ranges were a route into "unclassified"', async (code, cls, parent) => {
    const res = await post({
      account_code: code,
      account_name: 'Off-prefix (rejected)',
      account_class: cls,
      account_type: 'DETAIL',
      parent_account_code: parent,
    });
    expect(res.statusCode).toBe(400);
    expect(await exists(code)).toBe(false);
  });
});

describe('deactivation cannot strand anything (L-34)', () => {
  const patch = (code: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/accounting/accounts/${code}`,
      headers: authHeaders(ownerToken),
      payload,
    });

  it('refuses a header whose children are still active — the balance check only ever saw the header’s 0', async () => {
    // 6810 sits, active, under 6800.
    const res = await patch('6800', { is_active: false });
    expect(res.statusCode).toBe(400);
    expect((await prisma.chartOfAccounts.findFirstOrThrow({ where: { facilityId: TEST_FACILITY_ID, accountCode: '6800' } })).isActive).toBe(true);
  });

  it('refuses an account a rate plan still posts to — the invoice would fail long after', async () => {
    expect(
      (await post({ account_code: '4310', account_name: 'Cold Room Hire', account_class: 'REVENUE', account_type: 'DETAIL', parent_account_code: '4100' })).statusCode,
    ).toBe(201);
    await prisma.ratePlan.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        name: 'coa-guardrails plan',
        rateType: 'DAILY_PER_BAG',
        rateAmountPkr: 1,
        revenueAccountCode: '4310',
      },
    });
    const res = await patch('4310', { is_active: false });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toMatch(/rate plan/);
  });

  it('refuses to clear a header’s section — its children would sit on no statement (L-38)', async () => {
    const res = await patch('6800', { statement_section: null });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to move a system header between sections', async () => {
    // 4200 Other Income is a seeded header; moving it would re-cut every P&L.
    const res = await patch('4200', { statement_section: 'REVENUE' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
  });

  // The database holds the same two rules (migration 0035), so no path round
  // the API can put an account on no statement either.
  it('the chart itself refuses a header with no section and a detail with no header', async () => {
    const row = { facilityId: TEST_FACILITY_ID, accountClass: 'EXPENSE' as const, normalBalance: 'DEBIT' as const };
    await expect(
      prisma.chartOfAccounts.create({ data: { ...row, accountCode: '6850', accountName: 'no section', accountType: 'HEADER' } }),
    ).rejects.toThrow(/chart_of_accounts_header_has_section/);
    await expect(
      prisma.chartOfAccounts.create({ data: { ...row, accountCode: '6850', accountName: 'no header', accountType: 'DETAIL' } }),
    ).rejects.toThrow(/chart_of_accounts_detail_has_parent/);
  });
});

describe('an account the engine posts to by role cannot be retired', () => {
  afterAll(async () => {
    // A red run would have deactivated it; every statement reads it by role.
    await prisma.chartOfAccounts.updateMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '3020' },
      data: { isActive: true },
    });
  });

  it('refuses to deactivate retained earnings, though the seed does not flag it system', async () => {
    // 3020 is a registry role (SYSTEM_ACCOUNTS.RETAINED_EARNINGS): the statements
    // look it up, opening balances post to it. Deactivating or deleting it was
    // allowed because only is_system_account protected an account.
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/3020',
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
  });
});

describe('the chart flags are the owner’s to set, until the account is used (L-34)', () => {
  const patch = (code: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/accounting/accounts/${code}`,
      headers: authHeaders(ownerToken),
      payload,
    });

  it('opens a second bank account as cash from the start', async () => {
    const res = await post({
      account_code: '1295',
      account_name: 'Bank Account — Second',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1000',
      is_cash_equivalent: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body).data.is_cash_equivalent).toBe(true);
  });

  it('refuses "cash" on anything but an asset', async () => {
    const res = await post({
      account_code: '6820',
      account_name: 'Not cash (rejected)',
      account_class: 'EXPENSE',
      account_type: 'DETAIL',
      parent_account_code: '6000',
      is_cash_equivalent: true,
    });
    expect(res.statusCode).toBe(400);
    expect(await exists('6820')).toBe(false);
  });

  it('refuses to change a system account’s flags — the engine relies on them', async () => {
    const res = await patch('1010', { allow_manual_posting: false });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
  });

  it('refuses to change what an account IS once it carries postings', async () => {
    // 1291 was pinned with a posting above.
    const res = await patch('1291', { is_cash_equivalent: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toMatch(/posting/i);
  });

  it('no longer reports the dead cash_flow_section (L-19)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/accounting/accounts/1010', headers: authHeaders(ownerToken) });
    expect(JSON.parse(res.body).data).not.toHaveProperty('cash_flow_section');
  });
});
