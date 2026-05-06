import type { JournalEntryDraft, JournalEntryLineDraft } from './types';
import { arAccountForParty, revenueAccountForCommodity } from './types';

type AccrualLineInput = {
  lot: { id: string; lotNumber: string; commodityName: string };
  billingParty: { id: string; partyType: string; name: string };
  accruedAmountPkr: number;
  ratePlanRevenueCode?: string | null;
};

type Input = {
  facilityPeriodId: string;
  accrualDate: Date;
  bookType: 'PACCI' | 'KATCHI';
  lines: AccrualLineInput[];
};

/**
 * JE-11: Accrued Revenue (Month-End, Ongoing Storage).
 *
 *   DR  1110/1120/1130 Receivable                   accrued_amount per lot
 *     CR  4010-4050 Storage Revenue (by commodity)   accrued_amount per lot
 *
 * Captures revenue earned but not yet invoiced for lots still in storage at period end.
 * Reversed by JE-11R at the start of the next period (the actual invoice posts JE-01 in full).
 */
export function buildJE11AccruedRevenue(input: Input): JournalEntryDraft {
  const lines: JournalEntryLineDraft[] = [];

  for (const accrual of input.lines) {
    const arAccount = arAccountForParty(accrual.billingParty.partyType);
    const revenueAccount =
      accrual.ratePlanRevenueCode ?? revenueAccountForCommodity(accrual.lot.commodityName);
    const amount = round2(accrual.accruedAmountPkr);

    lines.push({
      accountCode: arAccount,
      debitAmount: amount,
      creditAmount: 0,
      partyId: accrual.billingParty.id,
      lotId: accrual.lot.id,
      description: `Accrued storage — Lot ${accrual.lot.lotNumber}`,
    });
    lines.push({
      accountCode: revenueAccount,
      debitAmount: 0,
      creditAmount: amount,
      partyId: accrual.billingParty.id,
      lotId: accrual.lot.id,
      description: `Accrued revenue — Lot ${accrual.lot.lotNumber}`,
    });
  }

  return {
    entryType: 'ACCRUAL',
    bookType: input.bookType,
    sourceTable: 'manual',
    sourceId: input.facilityPeriodId,
    entryDate: input.accrualDate,
    description: `Month-end accrued storage revenue (${input.lines.length} lots)`,
    lines,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
