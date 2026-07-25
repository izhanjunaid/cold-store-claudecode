import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import { advisoryXactLock } from '../advisory-lock';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

async function advisoryLockCount(tx: {
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T>;
}): Promise<number> {
  const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`,
  );
  return Number(rows[0]?.n ?? 0);
}

describe('advisoryXactLock', () => {
  it('actually holds a transaction-scoped advisory lock', async () => {
    await prisma.$transaction(async (tx) => {
      expect(await advisoryLockCount(tx)).toBe(0);
      await advisoryXactLock(tx, 'test:holds-a-lock');
      expect(await advisoryLockCount(tx)).toBe(1);
    });
  });

  it('releases the lock when the transaction ends', async () => {
    await prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, 'test:released-after-commit');
      expect(await advisoryLockCount(tx)).toBe(1);
    });
    await prisma.$transaction(async (tx) => {
      expect(await advisoryLockCount(tx)).toBe(0);
    });
  });

  it('serialises two concurrent transactions on the same key', async () => {
    const order: string[] = [];

    const first = prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, 'test:serialises');
      order.push('a-locked');
      await new Promise((r) => setTimeout(r, 300));
      order.push('a-done');
    });

    // Start slightly later so A is guaranteed to win the lock.
    const second = (async () => {
      await new Promise((r) => setTimeout(r, 50));
      return prisma.$transaction(async (tx) => {
        await advisoryXactLock(tx, 'test:serialises');
        order.push('b-locked');
      });
    })();

    await Promise.all([first, second]);

    // B must not acquire until A's transaction has committed.
    expect(order).toEqual(['a-locked', 'a-done', 'b-locked']);
  });

  // Regression guard for the defect this helper was created to fix. The former idiom
  // — `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(...) IS NOT NULL OR TRUE` — was
  // used by every document-number generator and acquired nothing, because PostgreSQL
  // folds the `OR TRUE` disjunction and never evaluates the call. This test pins the
  // difference so the broken form cannot quietly come back.
  it('the legacy OR-TRUE idiom acquired no lock (why this helper exists)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
        'test:legacy-idiom',
      );
      expect(await advisoryLockCount(tx)).toBe(0);

      await advisoryXactLock(tx, 'test:legacy-idiom');
      expect(await advisoryLockCount(tx)).toBe(1);
    });
  });
});
