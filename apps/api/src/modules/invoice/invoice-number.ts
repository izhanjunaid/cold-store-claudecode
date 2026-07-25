import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from '../../common/advisory-lock';

export function formatInvoiceNumber(date: Date, next: number): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const seq = String(next).padStart(4, '0');
  return `INV-${yyyy}${mm}-${seq}`;
}

export function invoiceNumberPrefix(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
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
