import type { Prisma } from '@coldchain/db';
import { round2 } from '@coldchain/shared';

export type InvoiceSettlement = {
  paidPkr: number;
  creditedPkr: number;
  writtenOffPkr: number;
  /** paid + credited + written off — what `invoices.amount_paid_pkr` stores. */
  settledPkr: number;
};

/**
 * Recompute what settles an invoice from the documents that settle it, and store
 * the total (docs/25 R-21). Every path that touches a settlement — allocating a
 * receipt, dishonouring it, issuing or cancelling a credit note, writing off —
 * calls this instead of nudging a counter, so the stored figure can never drift
 * from its sources.
 *
 * `amount_paid_pkr` holds the settled total (it is the only column there is);
 * the split is recovered at read time by `settlementOf`.
 */
export async function refreshInvoiceSettlement(tx: Prisma.TransactionClient, invoiceId: string): Promise<InvoiceSettlement> {
  const [allocations, credits, writeOff] = await Promise.all([
    tx.paymentAllocation.aggregate({ where: { invoiceId, voidedAt: null }, _sum: { allocatedAmountPkr: true } }),
    tx.creditNote.aggregate({ where: { originalInvoiceId: invoiceId, voidedAt: null }, _sum: { totalPkr: true } }),
    // The standing bad-debt entry sourced to the invoice; its one credit line is the AR written off.
    tx.journalEntryLine.aggregate({
      where: {
        creditAmount: { gt: 0 },
        journalEntry: { sourceTable: 'invoices', sourceId: invoiceId, entryType: 'BAD_DEBT', postingStatus: 'POSTED', reversedById: null },
      },
      _sum: { creditAmount: true },
    }),
  ]);
  const paidPkr = round2(Number(allocations._sum.allocatedAmountPkr ?? 0));
  const creditedPkr = round2(Number(credits._sum.totalPkr ?? 0));
  const writtenOffPkr = round2(Number(writeOff._sum.creditAmount ?? 0));
  const settledPkr = round2(paidPkr + creditedPkr + writtenOffPkr);
  await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaidPkr: settledPkr } });
  return { paidPkr, creditedPkr, writtenOffPkr, settledPkr };
}

/** The split of an invoice's stored settled total, from its live allocations and standing credit notes. */
export function settlementOf(inv: {
  amountPaidPkr: unknown;
  allocations: { allocatedAmountPkr: unknown }[];
  creditNotes: { totalPkr: unknown }[];
}): InvoiceSettlement {
  const paidPkr = round2(inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0));
  const creditedPkr = round2(inv.creditNotes.reduce((s, c) => s + Number(c.totalPkr), 0));
  const settledPkr = round2(Number(inv.amountPaidPkr));
  return { paidPkr, creditedPkr, writtenOffPkr: round2(settledPkr - paidPkr - creditedPkr), settledPkr };
}

/** Include these on any invoice read that reports its settlement (and what may still be done to it). */
export const SETTLEMENT_INCLUDE = {
  allocations: { where: { voidedAt: null }, select: { allocatedAmountPkr: true } },
  creditNotes: { where: { voidedAt: null }, select: { totalPkr: true } },
  surcharges: { where: { status: { not: 'VOID' as const } }, select: { id: true } },
} as const;
