import type { Prisma } from '@coldchain/db';

export function formatDispatchNoteNumber(date: Date, next: number): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `DN-${yy}${mm}${dd}-${seq}`;
}

export function dispatchNotePrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `DN-${yy}${mm}${dd}-`;
}

export async function generateDispatchNoteNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = dispatchNotePrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await tx.$queryRawUnsafe<unknown[]>(
    `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE`,
    lockKey,
  );

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(dispatch_note_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM outbound_events
     WHERE facility_id = $1::uuid AND dispatch_note_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatDispatchNoteNumber(date, next);
}
