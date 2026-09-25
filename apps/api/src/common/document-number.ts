import type { Prisma } from '@coldchain/db';
import { advisoryXactLock } from './advisory-lock';

/**
 * Every accounting document's number is PREFIX-PERIOD-SEQUENCE, with the sequence
 * restarting each period per facility. This is the one implementation; there were
 * ten copies of the same query, three of them numbering in local time while the
 * rest used UTC (docs/25 R-34, C-28, C-43).
 */

/** Numbered tables and the column that holds the number. A closed list: both are interpolated into SQL. */
const NUMBERED_COLUMN = {
  journal_entries: 'entry_number',
  credit_notes: 'credit_note_number',
  invoices: 'invoice_number',
  payments: 'receipt_number',
  expense_vouchers: 'voucher_number',
  payroll_runs: 'run_number',
  fixed_assets: 'asset_number',
  employee_advances: 'advance_number',
  party_loans: 'loan_number',
  bills: 'bill_number',
  supplier_payments: 'payment_number',
} as const;

export type NumberedTable = keyof typeof NUMBERED_COLUMN;

/**
 * The period part of a number, from the document's own date in UTC — the same
 * calendar the accounting period is derived from, so a document is never
 * numbered into a different month than it posts to.
 */
export function documentNumberPrefix(code: string, date: Date, scheme: 'monthly' | 'daily' | 'yearly'): string {
  const yyyy = String(date.getUTCFullYear());
  const yy = yyyy.slice(2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const period = scheme === 'monthly' ? `${yyyy}${mm}` : scheme === 'daily' ? `${yy}${mm}${dd}` : yyyy;
  return `${code}-${period}-`;
}

export function formatDocumentNumber(prefix: string, sequence: number, width: number): string {
  return `${prefix}${String(sequence).padStart(width, '0')}`;
}

/**
 * The next number under `prefix`. Serialised per facility and prefix by an advisory
 * lock (the unique index on each number column is the backstop, not the guard).
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  facilityId: string,
  table: NumberedTable,
  prefix: string,
  width: number,
): Promise<string> {
  await advisoryXactLock(tx, `${facilityId}:${prefix}`);
  const column = NUMBERED_COLUMN[table];
  const rows = await tx.$queryRawUnsafe<{ next: number | bigint }[]>(
    `SELECT COALESCE(MAX(CAST(split_part(${column}, '-', 3) AS INT)), 0) + 1 AS next
     FROM ${table}
     WHERE facility_id = $1::uuid AND ${column} LIKE $2`,
    facilityId,
    `${prefix}%`,
  );
  return formatDocumentNumber(prefix, Number(rows[0]?.next ?? 1), width);
}
