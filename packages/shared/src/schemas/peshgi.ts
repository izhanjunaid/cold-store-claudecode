import { z } from 'zod';
import { BookType, LoanStatus, LoanRepaymentMethod } from './enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

// Re-export for module callers that prefer the legacy names
export const PartyLoanStatus = LoanStatus;
export const PeshgiPaymentMethod = LoanRepaymentMethod;
export const RepaymentMethod = LoanRepaymentMethod;

export const IssuePaymentMethod = z.enum(['CASH', 'BANK_TRANSFER']);
export type IssuePaymentMethodType = z.infer<typeof IssuePaymentMethod>;

export const IssuePeshgiRequest = z.object({
  party_id: z.string().uuid(),
  issue_date: dateOnly,
  principal_pkr: z.number().positive(),
  payment_method: IssuePaymentMethod,
  source_asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
  book_type: BookType.optional(),
  notes: z.string().optional(),
});
export type IssuePeshgiRequestType = z.infer<typeof IssuePeshgiRequest>;

export const RecordRepaymentRequest = z
  .object({
    repayment_date: dateOnly,
    amount_pkr: z.number().positive(),
    payment_method: LoanRepaymentMethod,
    asset_account_code: z.string().regex(/^[0-9]+$/).optional(),
    notes: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.payment_method !== 'DEDUCTED_FROM_PRODUCE' && !val.asset_account_code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asset_account_code'],
        message: 'asset_account_code is required for CASH or BANK_TRANSFER',
      });
    }
  });
export type RecordRepaymentRequestType = z.infer<typeof RecordRepaymentRequest>;

export const WriteOffPeshgiRequest = z.object({
  reason: z.string().trim().min(3),
  write_off_date: dateOnly.optional(),
});
export type WriteOffPeshgiRequestType = z.infer<typeof WriteOffPeshgiRequest>;

export const PartyLoanListQuery = z.object({
  party_id: z.string().uuid().optional(),
  status: LoanStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});
export type PartyLoanListQueryType = z.infer<typeof PartyLoanListQuery>;

export const PartyLoanRepaymentResponse = z.object({
  id: z.string().uuid(),
  repayment_date: z.string(),
  amount_pkr: z.number(),
  payment_method: LoanRepaymentMethod,
  asset_account_code: z.string().nullable(),
  payment_id: z.string().uuid().nullable(),
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
  status: LoanStatus,
  book_type: BookType,
  source_asset_account_code: z.string(),
  issue_journal_entry_id: z.string().uuid().nullable(),
  write_off_journal_entry_id: z.string().uuid().nullable(),
  write_off_reason: z.string().nullable(),
  write_off_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  repayments: z.array(PartyLoanRepaymentResponse).optional(),
});
export type PartyLoanResponseType = z.infer<typeof PartyLoanResponse>;
