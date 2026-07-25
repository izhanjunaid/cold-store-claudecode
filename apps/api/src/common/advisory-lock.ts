import type { Prisma } from '@coldchain/db';

/**
 * Take a transaction-scoped PostgreSQL advisory lock, released automatically at COMMIT
 * or ROLLBACK. Used to serialise operations that read-then-write a value no constraint
 * can guard — principally the per-facility document-number sequences.
 *
 * ## Why this helper exists
 *
 * The obvious way to call a `void`-returning function through Prisma does not work:
 * `$queryRaw` cannot deserialise `void` ("Failed to deserialize column of type 'void'"),
 * so `SELECT pg_advisory_xact_lock(...)` throws.
 *
 * The workaround previously used across the codebase was:
 *
 *     SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE
 *
 * That silently does nothing. PostgreSQL folds the `OR TRUE` disjunction and never
 * evaluates the lock call, so the statement returns a row having acquired no lock —
 * verified by inspecting `pg_locks` inside a transaction after running it (0 advisory
 * locks held). Every document-number generator used this form, which is why numbering
 * has in practice been protected only by the unique constraints behind it.
 *
 * Casting the result instead forces evaluation and gives Prisma a type it can decode.
 */
export async function advisoryXactLock(
  tx: Prisma.TransactionClient,
  key: string,
): Promise<void> {
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))::text AS _lock`, key);
}
