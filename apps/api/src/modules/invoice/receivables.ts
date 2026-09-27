import type { Prisma, PrismaClient, BookType } from '@coldchain/db';
import { AR_CONTROL_ACCOUNTS, round2, sumMoney, toIsoDate } from '@coldchain/shared';
import { partyBalances, postedLinesWhere } from '../accounting/ledger';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The one AR read model (docs/25 R-10, R-11, R-12, L-03). Aging, the party
 * statement, the dashboard and the credit-limit check all read the party's
 * lines on the receivable control accounts — so whatever posted there (an
 * invoice, a write-off, a manual correction, an opening balance and its
 * reversal) shows up everywhere, and nothing can disagree with the GL. There
 * used to be five different "what does this party owe" figures.
 */

/** What each party owes on one book, as of a date: debit − credit on the AR controls. */
export async function arBalances(
  db: Db,
  args: { facilityId: string; book: BookType; asOf?: Date; partyId?: string },
): Promise<Map<string, number>> {
  const sums = await partyBalances(db, {
    facilityId: args.facilityId,
    book: args.book,
    accounts: AR_CONTROL_ACCOUNTS,
    to: args.asOf,
    partyId: args.partyId,
  });
  return new Map([...sums].map(([party, s]) => [party, round2(s.debit - s.credit)]));
}

/** Everything a party owes across both books — what a credit limit is measured against. */
export async function creditExposure(db: Db, facilityId: string, partyId: string): Promise<number> {
  const [pacci, katchi] = await Promise.all(
    (['PACCI', 'KATCHI'] as const).map((book) => arBalances(db, { facilityId, book, partyId })),
  );
  return round2((pacci!.get(partyId) ?? 0) + (katchi!.get(partyId) ?? 0));
}

export type OpenItem = {
  partyId: string;
  /** The invoice, or null for a line that is no document's (opening balance, manual, legacy surcharge). */
  invoiceId: string | null;
  reference: string | null;
  date: Date;
  amountPkr: number;
};

/**
 * A party's open items on one book, as of a date — what aging buckets.
 *
 * An invoice's open amount is its own AR lines (the invoice, its void, its
 * write-off, its credit notes and their cancellations — all sourced to it)
 * less the receipts applied to it. Lines no document owns are items of their
 * own, netted with their reversals (a reversal inherits its original's
 * source). Receipts not yet applied are not items: they are the party's
 * unapplied credit, which is whatever is left between the items and the GL
 * balance — so the items plus that credit always equal the GL.
 *
 * ponytail: a receipt counts against an invoice from its own payment date —
 * payment_allocations has no date, so an advance applied later is aged as if
 * applied on receipt. Totals still tie to the GL; add an allocation date to be exact.
 */
export async function openItems(
  db: Db,
  args: { facilityId: string; book: BookType; asOf: Date; partyId?: string },
): Promise<OpenItem[]> {
  const lines = await db.journalEntryLine.findMany({
    where: {
      ...postedLinesWhere({ facilityId: args.facilityId, book: args.book, to: args.asOf }),
      accountCode: { in: [...AR_CONTROL_ACCOUNTS] },
      partyId: args.partyId ?? { not: null },
    },
    select: {
      partyId: true,
      debitAmount: true,
      creditAmount: true,
      journalEntry: { select: { sourceTable: true, sourceId: true, entryDate: true, entryNumber: true } },
    },
  });

  const creditNoteIds = [...new Set(lines.filter((l) => l.journalEntry.sourceTable === 'credit_notes').map((l) => l.journalEntry.sourceId))];
  const creditNotes = await db.creditNote.findMany({
    where: { id: { in: creditNoteIds } },
    select: { id: true, originalInvoiceId: true },
  });
  const invoiceOfCreditNote = new Map(creditNotes.map((c) => [c.id, c.originalInvoiceId]));

  const invoiceNet = new Map<string, number>();
  const other = new Map<string, OpenItem>();
  for (const l of lines) {
    const je = l.journalEntry;
    const amount = Number(l.debitAmount) - Number(l.creditAmount);
    const invoiceId =
      je.sourceTable === 'invoices' ? je.sourceId : je.sourceTable === 'credit_notes' ? invoiceOfCreditNote.get(je.sourceId) : undefined;
    if (invoiceId) {
      invoiceNet.set(invoiceId, (invoiceNet.get(invoiceId) ?? 0) + amount);
    } else if (je.sourceTable !== 'payments') {
      const key = `${l.partyId}:${je.sourceTable}:${je.sourceId}`;
      const item = other.get(key) ?? { partyId: l.partyId!, invoiceId: null, reference: je.entryNumber, date: je.entryDate, amountPkr: 0 };
      item.amountPkr += amount;
      if (je.entryDate < item.date) item.date = je.entryDate;
      other.set(key, item);
    }
  }

  const invoices = await db.invoice.findMany({
    where: { id: { in: [...invoiceNet.keys()] } },
    select: {
      id: true,
      billingPartyId: true,
      invoiceNumber: true,
      invoiceDate: true,
      allocations: { where: { voidedAt: null, payment: { paymentDate: { lte: args.asOf } } }, select: { allocatedAmountPkr: true } },
    },
  });
  const items: OpenItem[] = invoices.map((inv) => ({
    partyId: inv.billingPartyId,
    invoiceId: inv.id,
    reference: inv.invoiceNumber,
    date: inv.invoiceDate,
    amountPkr: round2((invoiceNet.get(inv.id) ?? 0) - inv.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0)),
  }));
  for (const item of other.values()) items.push({ ...item, amountPkr: round2(item.amountPkr) });
  return items.filter((i) => Math.abs(i.amountPkr) > 0.005);
}

export type StatementEntryType =
  | 'OPENING_BALANCE'
  | 'INVOICE'
  | 'SURCHARGE'
  | 'PAYMENT'
  | 'ADVANCE_APPLIED'
  | 'CREDIT_NOTE'
  | 'WRITE_OFF'
  | 'REVERSAL'
  | 'ADJUSTMENT';

function statementType(je: { sourceTable: string; entryType: string }): StatementEntryType {
  if (je.entryType === 'REVERSAL') return 'REVERSAL';
  if (je.sourceTable === 'opening_balances') return 'OPENING_BALANCE';
  if (je.sourceTable === 'invoice_surcharge' || je.entryType === 'LATE_PAYMENT_SURCHARGE') return 'SURCHARGE';
  if (je.entryType === 'BAD_DEBT') return 'WRITE_OFF';
  if (je.sourceTable === 'invoices') return 'INVOICE';
  if (je.sourceTable === 'credit_notes') return 'CREDIT_NOTE';
  if (je.entryType === 'ADVANCE_APPLIED') return 'ADVANCE_APPLIED';
  if (je.sourceTable === 'payments') return 'PAYMENT';
  return 'ADJUSTMENT';
}

/**
 * A party's statement on one book: its lines on the receivable control accounts,
 * one row per journal entry, with the running balance (docs/25 R-11). It used to
 * be rebuilt from documents — written-off invoices vanished while their payments
 * stayed, bad debts and manual corrections never appeared, and receipts showed at
 * gross including the part that repaid a loan.
 */
export async function partyStatement(
  db: Db,
  args: { facilityId: string; partyId: string; book: BookType; from?: Date; to?: Date },
) {
  const lines = await db.journalEntryLine.findMany({
    where: {
      ...postedLinesWhere({ facilityId: args.facilityId, book: args.book, to: args.to }),
      accountCode: { in: [...AR_CONTROL_ACCOUNTS] },
      partyId: args.partyId,
    },
    select: {
      debitAmount: true,
      creditAmount: true,
      journalEntry: {
        select: { id: true, entryNumber: true, entryDate: true, createdAt: true, entryType: true, sourceTable: true, sourceId: true, description: true },
      },
    },
  });

  const byEntry = new Map<string, { je: (typeof lines)[number]['journalEntry']; debit: number; credit: number }>();
  for (const l of lines) {
    const row = byEntry.get(l.journalEntry.id) ?? { je: l.journalEntry, debit: 0, credit: 0 };
    row.debit += Number(l.debitAmount);
    row.credit += Number(l.creditAmount);
    byEntry.set(l.journalEntry.id, row);
  }
  const entries = [...byEntry.values()].sort(
    (a, b) => a.je.entryDate.getTime() - b.je.entryDate.getTime() || a.je.createdAt.getTime() - b.je.createdAt.getTime(),
  );

  const ids = (table: string) => entries.filter((e) => e.je.sourceTable === table).map((e) => e.je.sourceId);
  const [invoices, payments, creditNotes] = await Promise.all([
    db.invoice.findMany({ where: { id: { in: ids('invoices') } }, select: { id: true, invoiceNumber: true } }),
    db.payment.findMany({ where: { id: { in: ids('payments') } }, select: { id: true, receiptNumber: true } }),
    db.creditNote.findMany({ where: { id: { in: ids('credit_notes') } }, select: { id: true, creditNoteNumber: true } }),
  ]);
  const documentNumber = new Map<string, string | null>([
    ...invoices.map((i) => [i.id, i.invoiceNumber] as const),
    ...payments.map((p) => [p.id, p.receiptNumber] as const),
    ...creditNotes.map((c) => [c.id, c.creditNoteNumber] as const),
  ]);

  let opening = 0;
  let balance = 0;
  const rows = [];
  for (const e of entries) {
    const net = e.debit - e.credit;
    if (args.from && e.je.entryDate < args.from) {
      opening += net;
      balance += net;
      continue;
    }
    balance += net;
    rows.push({
      date: toIsoDate(e.je.entryDate),
      type: statementType(e.je),
      reference: documentNumber.get(e.je.sourceId) ?? e.je.entryNumber,
      description: e.je.description,
      debit_pkr: round2(e.debit),
      credit_pkr: round2(e.credit),
      balance_pkr: round2(balance),
      id: e.je.id,
    });
  }

  return {
    opening_balance_pkr: round2(opening),
    entries: rows,
    total_debit_pkr: sumMoney(rows.map((r) => r.debit_pkr)),
    total_credit_pkr: sumMoney(rows.map((r) => r.credit_pkr)),
    closing_balance_pkr: round2(balance),
  };
}
