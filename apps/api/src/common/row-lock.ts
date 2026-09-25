import type { Prisma } from '@coldchain/db';

/**
 * Tables whose rows change state under money: every state transition on one of
 * them takes this lock first (docs/25 §2 invariant 6). Only some transitions used
 * to — payroll finalize and pay did not, so a double-click posted the payroll twice
 * (C-13). A closed list because the name is interpolated into SQL.
 */
export type LockableTable =
  | 'invoices'
  | 'credit_notes'
  | 'payments'
  | 'party_loans'
  | 'payroll_runs'
  | 'employee_advances'
  | 'fixed_assets'
  | 'expense_vouchers'
  | 'bills'
  | 'supplier_payments'
  | 'tax_remittances'
  | 'cash_transfers'
  | 'owner_equity_movements';

/**
 * Lock one row of `table` for the rest of the transaction. Returns false when the
 * row does not exist in this facility, so callers keep their own not-found error.
 */
export async function lockRow(
  tx: Prisma.TransactionClient,
  table: LockableTable,
  id: string,
  facilityId: string,
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM ${table} WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
    id,
    facilityId,
  );
  return rows.length > 0;
}
