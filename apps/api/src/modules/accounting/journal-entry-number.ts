import type { Prisma } from '@coldchain/db';

// UTC getters throughout so a document's number always agrees with the
// accounting period derived in period.ts (which also uses UTC). Local-time
// getters put a late-evening-UTC entry in the wrong month on non-UTC servers.
export function formatJournalEntryNumber(date: Date, next: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `JE-${yyyy}${mm}-${seq}`;
}

export function journalEntryNumberPrefix(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `JE-${yyyy}${mm}-`;
}

export async function generateJournalEntryNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = journalEntryNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(entry_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM journal_entries
     WHERE facility_id = $1::uuid AND entry_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatJournalEntryNumber(date, next);
}

export function formatCreditNoteNumber(date: Date, next: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `CN-${yyyy}${mm}-${seq}`;
}

export async function generateCreditNoteNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `CN-${yyyy}${mm}-`;
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(credit_note_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM credit_notes
     WHERE facility_id = $1::uuid AND credit_note_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatCreditNoteNumber(date, next);
}
