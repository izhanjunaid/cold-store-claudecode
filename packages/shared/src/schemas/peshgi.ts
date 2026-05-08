import { z } from 'zod';
import { BookType } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const PartyLoanStatus = z.enum(['ACTIVE', 'FULLY_RECOVERED', 'WRITTEN_OFF']);
export const PeshgiPaymentMethod = z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER']);

export const IssuePeshgiRequest = z.object({
  party_id: z.string().uuid(),
  issue_date: dateOnly,
  principal_pkr: z.number().positive(),
  source_asset_account_code: z.string().regex(/^[0-9]+$/).default('1010'),
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type IssuePeshgiRequestType = z.infer<typeof IssuePeshgiRequest>;

export const RecordRepaymentRequest = z.object({
  repayment_date: dateOnly,
  amount_pkr: z.number().positive(),
  payment_method: PeshgiPaymentMethod,
  asset_account_code: z.string().regex(/^[0-9]+$/),
  notes: z.string().optional(),
});
export type RecordRepaymentRequestType = z.infer<typeof RecordRepaymentRequest>;

export const PartyLoanListQuery = z.object({
  party_id: z.string().uuid().optional(),
  status: PartyLoanStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type PartyLoanListQueryType = z.infer<typeof PartyLoanListQuery>;

export const PartyLoanRepaymentResponse = z.object({
  id: z.string().uuid(),
  repayment_date: z.string(),
  amount_pkr: z.number(),
  payment_method: PeshgiPaymentMethod,
  asset_account_code: z.string(),
  journal_entry_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type PartyLoanRepaymentResponseType = z.infer<typeof PartyLoanRepaymentResponse>;

export const PartyLoanResponse = z.object({
  id: z.string().uuid(),
  loan_number: z.string(),
  party_id: z.string().uuid(),
  party_name: z.string().optional(),
  issue_date: z.string(),
  principal_pkr: z.number(),
  balance_outstanding_pkr: z.number(),
  status: PartyLoanStatus,
  book_type: BookType,
  source_asset_account_code: z.string(),
  issue_journal_entry_id: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  repayments: z.array(PartyLoanRepaymentResponse).optional(),
});
export type PartyLoanResponseType = z.infer<typeof PartyLoanResponse>;
