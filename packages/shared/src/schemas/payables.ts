import { z } from 'zod';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Void a posted payables / treasury document: its entry is reversed, the row stays. */
export const VoidDocumentRequest = z.object({
  reason: z.string().trim().min(3).max(400),
  /** Defaults to today; may not precede the document's own date. */
  void_date: dateOnly.optional(),
});
export type VoidDocumentRequestType = z.infer<typeof VoidDocumentRequest>;

// ============================================================
// Cash transfers (docs/25 C-44) — the create request is CreateCashTransferRequest
// ============================================================

export const CashTransferListQuery = z.object({
  book_type: BookType.optional(),
  date_from: dateOnly.optional(),
  date_to: dateOnly.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(50),
});
export type CashTransferListQueryType = z.infer<typeof CashTransferListQuery>;

export const CashTransferAction = z.enum(['void']);
export type CashTransferActionType = z.infer<typeof CashTransferAction>;
