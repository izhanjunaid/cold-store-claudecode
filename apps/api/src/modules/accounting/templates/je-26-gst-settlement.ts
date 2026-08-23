import type { JournalEntryDraft } from './types';
import { ACCOUNT_GST_PAYABLE } from './types';

export const ACCOUNT_SALES_TAX_INPUT = '1260';

type Input = {
  facilityId: string;
  bookType: 'PACCI' | 'KATCHI';
  /** When the money actually leaves — not the tax period end. */
  paymentDate: Date;
  /** Last day of the tax period being settled, for the description only. */
  taxPeriodEnd: Date;
  outputTaxPkr: number;
  inputTaxAppliedPkr: number;
  netRemittedPkr: number;
  bankAccountCode: string;
};

/**
 * JE-26: Sales tax settlement.
 *
 *   DR  2020 GST Payable — Output Tax        output tax outstanding
 *     CR  1260 Sales Tax — Input/Adjustable    input tax applied
 *     CR  1010/1020/1030                       the net remitted
 *
 * 2020 was credited by JE-01 on every invoice and debited by nothing, so the
 * liability grew without bound and the balance sheet permanently overstated it
 * (backlog P1-4). This is the missing debit.
 *
 * The amount is the 2020 balance **as of the tax period end**, while the entry
 * is dated at the payment date. Those are two different dates on purpose: the
 * liability is owed at the period end but remitted weeks later, so dating the
 * settlement at the period end would understate liabilities on the very
 * balance sheet the return is prepared from.
 *
 * Input tax is applied only up to the output tax. Any excess stays in 1260 and
 * carries forward, which is what it is — an adjustable credit against future
 * output tax, not a refund receivable.
 */
export function buildJE26GstSettlement(input: Input): JournalEntryDraft {
  const round = (n: number) => Math.round(n * 100) / 100;
  const lines: JournalEntryDraft['lines'] = [
    {
      accountCode: ACCOUNT_GST_PAYABLE,
      debitAmount: round(input.outputTaxPkr),
      creditAmount: 0,
      description: `Output tax settled to ${input.taxPeriodEnd.toISOString().slice(0, 10)}`,
    },
  ];

  if (input.inputTaxAppliedPkr > 0) {
    lines.push({
      accountCode: ACCOUNT_SALES_TAX_INPUT,
      debitAmount: 0,
      creditAmount: round(input.inputTaxAppliedPkr),
      description: 'Input tax adjusted against output tax',
    });
  }

  if (input.netRemittedPkr > 0) {
    lines.push({
      accountCode: input.bankAccountCode,
      debitAmount: 0,
      creditAmount: round(input.netRemittedPkr),
      description: 'Net sales tax remitted',
    });
  }

  return {
    entryType: 'GOVT_REMITTANCE',
    bookType: input.bookType,
    sourceTable: 'gst_settlement',
    sourceId: input.facilityId,
    entryDate: input.paymentDate,
    description: `Sales tax settlement for the period ended ${input.taxPeriodEnd.toISOString().slice(0, 10)}`,
    lines,
  };
}
