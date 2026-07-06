import type { PrismaClient } from '@coldchain/db';

/**
 * Toggle the DB-level financial integrity guards (immutability triggers,
 * balance constraint trigger, append-only audit_log) installed by the
 * financial_audit_and_integrity_guards migration.
 *
 * Test cleanup must run inside withGuardsDisabled() because production
 * financial records are protected against UPDATE/DELETE at the database
 * level. The .catch() swallows the error when the migration has not been
 * applied yet so pre-migration runs still execute cleanup.
 */
export async function disableFinancialGuards(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT financial_guards_set(false)`).then(
    () => undefined,
    () => undefined,
  );
}

export async function enableFinancialGuards(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT financial_guards_set(true)`).then(
    () => undefined,
    () => undefined,
  );
}

export async function withGuardsDisabled(prisma: PrismaClient, fn: () => Promise<void>): Promise<void> {
  await disableFinancialGuards(prisma);
  try {
    await fn();
  } finally {
    await enableFinancialGuards(prisma);
  }
}
