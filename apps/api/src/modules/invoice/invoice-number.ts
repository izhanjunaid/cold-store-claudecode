import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

// UTC throughout, matching period derivation (`period.ts`) and the phase/19 fix to
// journal-entry numbering. With local getters, a document created near a month
// boundary on a non-UTC server could be numbered into a different month than the
// accounting period it posts to.
export function formatInvoiceNumber(date: Date, next: number): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `INV-${yyyy}${mm}-${seq}`;
}

export function invoiceNumberPrefix(date: Date): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `INV-${yyyy}${mm}-`;
}

export async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  date: Date,
): Promise<string> {
  const prefix = invoiceNumberPrefix(date);
  const lockKey = `${facilityId}:${prefix}`;

  await advisoryXactLock(tx, lockKey);

  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(invoice_number, '-', 3) AS INT)), 0) + 1 AS next
     FROM invoices
     WHERE facility_id = $1::uuid AND invoice_number LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  const next = Number(rows[0]?.next ?? 1);
  return formatInvoiceNumber(date, next);
}
