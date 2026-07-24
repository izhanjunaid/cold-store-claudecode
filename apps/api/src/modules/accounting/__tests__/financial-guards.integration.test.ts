/**
 * DB-level financial integrity guards (audit findings F-1, F-3, F-4.3 in
 * docs/16_accounting_module_audit.md):
 *  - audit triggers on financial tables (who/when/before-after)
 *  - posted journal entries immutable except POSTED→REVERSED
 *  - deferred SUM(debit)=SUM(credit) constraint per entry
 *  - per-line CHECK constraints
 *  - chart_of_accounts structure locked once the account has postings
 *  - audit_log append-only
 *  - period_locks cannot be deleted
 *
 * These tests exercise raw SQL on purpose: the guards exist precisely for
 * write paths that bypass JournalEntryService.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;

type AuditRow = {
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};

async function auditRows(tableName: string, recordId: string): Promise<AuditRow[]> {
  return prisma.$queryRawUnsafe<AuditRow[]>(
    `SELECT action::text AS action, old_values, new_values
     FROM audit_log WHERE table_name = $1 AND record_id = $2::uuid
     ORDER BY changed_at ASC`,
    tableName,
    recordId,
  );
}

async function postManualJe(
  status: 'AUTO_DRAFT' | 'POSTED',
  entryDate = '2026-03-15',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(managerToken),
    payload: {
      entry_date: entryDate,
      description: `guards test (${status})`,
      posting_status: status,
      lines: [
        { account_code: '1010', debit_amount: 100, credit_amount: 0 },
        { account_code: '4050', debit_amount: 0, credit_amount: 100 },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id as string;
}

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { reversedById: null },
    });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '9901' },
    });
    await prisma.chartOfAccounts.updateMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: '1010' },
      data: { accountName: 'Cash on Hand', accountClass: 'ASSET' },
    });
    await prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE facility_id = $1::uuid`, TEST_FACILITY_ID);
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

// ============================================================
// Audit coverage (F-1)
// ============================================================

describe('audit triggers on financial tables', () => {
  it('posting a journal entry writes an INSERT audit row', async () => {
    const jeId = await postManualJe('POSTED');
    const rows = await auditRows('journal_entries', jeId);
    expect(rows.length).toBe(1);
    expect(rows[0]!.action).toBe('INSERT');
    expect(rows[0]!.new_values).not.toBeNull();
    expect((rows[0]!.new_values as Record<string, unknown>)['description']).toBe('guards test (POSTED)');
  });

  it('renaming an account writes an UPDATE audit row with before/after values', async () => {
    // 6050 Insurance is non-system — system accounts reject renames (phase/19).
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6050',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Insurance (renamed)' },
    });
    expect(res.statusCode).toBe(200);
    const accountId = JSON.parse(res.body).data.id as string;

    const rows = await auditRows('chart_of_accounts', accountId);
    const update = rows.find((r) => r.action === 'UPDATE');
    expect(update).toBeTruthy();
    expect((update!.old_values as Record<string, unknown>)['account_name']).toBe('Insurance');
    expect((update!.new_values as Record<string, unknown>)['account_name']).toBe('Insurance (renamed)');

    // Restore so the account name stays stable for other suites.
    await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6050',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Insurance' },
    });
  });

  it('deleting a draft entry writes a DELETE audit row', async () => {
    const draftId = await postManualJe('AUTO_DRAFT');
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1::uuid`, draftId);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = $1::uuid`, draftId);

    const rows = await auditRows('journal_entries', draftId);
    const del = rows.find((r) => r.action === 'DELETE');
    expect(del).toBeTruthy();
    expect(del!.old_values).not.toBeNull();
    expect((del!.old_values as Record<string, unknown>)['id']).toBe(draftId);
  });
});

// ============================================================
// Posted journal entry immutability (F-3)
// ============================================================

describe('posted journal entries are immutable at the DB level', () => {
  it('rejects a raw UPDATE of a posted entry', async () => {
    const jeId = await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(`UPDATE journal_entries SET description = 'tampered' WHERE id = $1::uuid`, jeId),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects a raw DELETE of a posted entry', async () => {
    const jeId = await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = $1::uuid`, jeId),
    ).rejects.toThrow(/cannot be deleted/i);
  });

  it('rejects a raw UPDATE of a posted entry line', async () => {
    const jeId = await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE journal_entry_lines SET debit_amount = 999 WHERE journal_entry_id = $1::uuid AND debit_amount > 0`,
        jeId,
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('allows the POSTED → REVERSED transition (reversal linkage only)', async () => {
    const originalId = await postManualJe('POSTED');
    const reversingId = await postManualJe('POSTED');
    const count = await prisma.$executeRawUnsafe(
      `UPDATE journal_entries SET posting_status = 'REVERSED', reversed_by = $2::uuid WHERE id = $1::uuid`,
      originalId,
      reversingId,
    );
    expect(count).toBe(1);
  });

  it('rejects any further change to a REVERSED entry', async () => {
    const originalId = await postManualJe('POSTED');
    const reversingId = await postManualJe('POSTED');
    await prisma.$executeRawUnsafe(
      `UPDATE journal_entries SET posting_status = 'REVERSED', reversed_by = $2::uuid WHERE id = $1::uuid`,
      originalId,
      reversingId,
    );
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE journal_entries SET description = 'tampered after reversal' WHERE id = $1::uuid`,
        originalId,
      ),
    ).rejects.toThrow(/immutable/i);
  });

  it('allows editing and deleting AUTO_DRAFT entries', async () => {
    const draftId = await postManualJe('AUTO_DRAFT');
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE journal_entries SET description = 'draft edited' WHERE id = $1::uuid`,
      draftId,
    );
    expect(updated).toBe(1);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1::uuid`, draftId);
    const deleted = await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = $1::uuid`, draftId);
    expect(deleted).toBe(1);
  });
});

// ============================================================
// Balance + line-level constraints (F-3)
// ============================================================

describe('DB-level double-entry constraints', () => {
  it('rejects an unbalanced entry at commit', async () => {
    const entryId = '00000000-0000-0000-0000-00000000ef01';
    await expect(
      prisma.$transaction([
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_entries
             (id, facility_id, entry_number, entry_date, entry_type, book_type, source_table, source_id,
              description, posting_status, period_month, period_year, created_by)
           VALUES ($1::uuid, $2::uuid, 'JE-GUARD-0001', '2026-03-15', 'ADJUSTMENT', 'PACCI', 'manual',
                   '00000000-0000-0000-0000-000000000010', 'unbalanced', 'POSTED', 3, 2026,
                   '00000000-0000-0000-0000-000000000010')`,
          entryId,
          TEST_FACILITY_ID,
        ),
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_entry_lines
             (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount)
           VALUES (gen_random_uuid(), $1::uuid, 1, '1010', $2::uuid, 100, 0)`,
          entryId,
          TEST_FACILITY_ID,
        ),
      ]),
    ).rejects.toThrow(/unbalanced/i);
  });

  it('rejects injecting lines into an already-posted entry, even balanced ones', async () => {
    const jeId = await postManualJe('POSTED');
    await expect(
      prisma.$transaction([
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_entry_lines
             (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount)
           VALUES (gen_random_uuid(), $1::uuid, 98, '1010', $2::uuid, 50, 0)`,
          jeId,
          TEST_FACILITY_ID,
        ),
        prisma.$executeRawUnsafe(
          `INSERT INTO journal_entry_lines
             (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount)
           VALUES (gen_random_uuid(), $1::uuid, 99, '4050', $2::uuid, 0, 50)`,
          jeId,
          TEST_FACILITY_ID,
        ),
      ]),
    ).rejects.toThrow(/immutable/i);
  });

  it('rejects a line with a negative amount', async () => {
    const draftId = await postManualJe('AUTO_DRAFT');
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO journal_entry_lines
           (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount)
         VALUES (gen_random_uuid(), $1::uuid, 99, '1010', $2::uuid, -5, 0)`,
        draftId,
        TEST_FACILITY_ID,
      ),
    ).rejects.toThrow(/check|constraint/i);
  });

  it('rejects a line carrying both a debit and a credit', async () => {
    const draftId = await postManualJe('AUTO_DRAFT');
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO journal_entry_lines
           (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount)
         VALUES (gen_random_uuid(), $1::uuid, 99, '1010', $2::uuid, 10, 10)`,
        draftId,
        TEST_FACILITY_ID,
      ),
    ).rejects.toThrow(/check|constraint/i);
  });
});

// ============================================================
// Chart of accounts: structure locked once used (F-12 fix b)
// ============================================================

describe('chart_of_accounts structural fields lock once the account has postings', () => {
  it('rejects a raw account_class change on an account with journal lines', async () => {
    await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE chart_of_accounts SET account_class = 'EXPENSE'
         WHERE facility_id = $1::uuid AND account_code = '1010'`,
        TEST_FACILITY_ID,
      ),
    ).rejects.toThrow(/locked/i);
  });

  it('still allows structural changes on an unused account', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '9901',
        account_name: 'Guards Test Account',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        parent_account_code: '6000',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(201);
    const count = await prisma.$executeRawUnsafe(
      `UPDATE chart_of_accounts SET parent_account_code = '5000'
       WHERE facility_id = $1::uuid AND account_code = '9901'`,
      TEST_FACILITY_ID,
    );
    expect(count).toBe(1);
  });
});

// ============================================================
// audit_log append-only (F-2a) and period_locks (F-4.3)
// ============================================================

describe('audit_log is append-only', () => {
  it('rejects UPDATE and DELETE of audit rows', async () => {
    await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE audit_log SET reason = 'tampered' WHERE facility_id = $1::uuid`,
        TEST_FACILITY_ID,
      ),
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE facility_id = $1::uuid`, TEST_FACILITY_ID),
    ).rejects.toThrow(/append-only/i);
  });
});

describe('period_locks history is preserved', () => {
  it('blocks raw DELETE of a period lock and audits the unlock overwrite', async () => {
    const lockRes = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2025, period_month: 11, reason: 'guards test' },
    });
    expect(lockRes.statusCode).toBe(201);
    const lockId = JSON.parse(lockRes.body).data.id as string;

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM period_locks WHERE id = $1::uuid`, lockId),
    ).rejects.toThrow(/cannot be deleted/i);

    const unlockRes = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks/2025/11/unlock',
      headers: authHeaders(ownerToken),
      payload: { reason: 'guards test unlock' },
    });
    expect(unlockRes.statusCode).toBe(200);

    const rows = await auditRows('period_locks', lockId);
    expect(rows.some((r) => r.action === 'INSERT')).toBe(true);
    const update = rows.find((r) => r.action === 'UPDATE');
    expect(update).toBeTruthy();
    expect((update!.old_values as Record<string, unknown>)['unlocked_at']).toBeNull();
    expect((update!.new_values as Record<string, unknown>)['unlocked_at']).not.toBeNull();
  });
});

// ============================================================
// Test-harness escape hatch
// ============================================================

describe('financial_guards_set', () => {
  it('is not executable by PUBLIC (F-2a: migration 0010 revoke)', async () => {
    // proacl IS NULL means "default ACL", which for functions includes EXECUTE
    // for PUBLIC — so the revoke must leave an explicit non-null ACL with no
    // PUBLIC (grantee oid 0) EXECUTE entry. This locks the migration in CI and
    // catches any future re-grant. The owner keeps EXECUTE (the test-harness
    // toggle above still works); production hardening additionally runs the
    // api under a non-owner role (scripts/app-role.sql) that never gets it.
    const rows = await prisma.$queryRawUnsafe<
      { default_acl: boolean; public_execute: boolean }[]
    >(`
      SELECT p.proacl IS NULL AS default_acl,
             COALESCE((SELECT bool_or(a.grantee = 0)
                       FROM aclexplode(p.proacl) a
                       WHERE a.privilege_type = 'EXECUTE'), false) AS public_execute
      FROM pg_proc p
      WHERE p.proname = 'financial_guards_set'
    `);
    expect(rows.length).toBe(1);
    expect(rows[0]!.default_acl).toBe(false);
    expect(rows[0]!.public_execute).toBe(false);
  });

  it('allows purging posted entries while disabled and blocks again after re-enable', async () => {
    const jeId = await postManualJe('POSTED');
    await withGuardsDisabled(prisma, async () => {
      await prisma.$executeRawUnsafe(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1::uuid`, jeId);
      const deleted = await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = $1::uuid`, jeId);
      expect(deleted).toBe(1);
    });
    const survivorId = await postManualJe('POSTED');
    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = $1::uuid`, survivorId),
    ).rejects.toThrow(/cannot be deleted/i);
  });
});
