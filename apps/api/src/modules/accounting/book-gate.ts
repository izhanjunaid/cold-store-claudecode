import { Errors } from '../../common/errors';
import { roleAtLeast } from '../../plugins/auth';

/**
 * KATCHI (informal book) controls — audit finding F-9. The write gate was
 * previously copy-pasted onto five controllers while payments, lots and
 * credit notes accepted book_type ungated; reads had no gate at all.
 *
 * Writes: only OWNER may put a document or entry on the KATCHI book.
 * Derived postings (e.g. JE-01 from a KATCHI lot's invoice) inherit the
 * source's book, so the gate belongs at every source-document boundary.
 */
export function assertKatchiWriteAllowed(role: string | undefined, bookType?: string | null): void {
  if (bookType === 'KATCHI' && role !== 'OWNER') {
    throw Errors.FORBIDDEN('Only OWNER can post KATCHI entries');
  }
}

/**
 * Reads: reports default to the official PACCI book; viewing the KATCHI
 * book requires MANAGER or higher (per 09_accounting_spec §KATCHI/PACCI).
 * Returns the effective book to query.
 */
export function resolveBookTypeForRead(
  role: string | undefined,
  requested?: string,
): 'PACCI' | 'KATCHI' {
  const bookType = (requested ?? 'PACCI') as 'PACCI' | 'KATCHI';
  if (bookType === 'KATCHI' && !roleAtLeast(role, 'MANAGER')) {
    throw Errors.FORBIDDEN('KATCHI book requires MANAGER or higher');
  }
  return bookType;
}
