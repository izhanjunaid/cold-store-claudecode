import type { Prisma, PrismaClient, BookType } from '@coldchain/db';
import { AR_CONTROL_ACCOUNTS, SYSTEM_ACCOUNTS, round2, sumMoney, toIsoDate } from '@coldchain/shared';
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

/**
 * The party's unpaid peshgi (cash advances) on one book, from the ledger. Peshgi has
 * its own account, outside the receivable controls, so a statement and an "amount
 * owed" built on those alone left it out (docs/31 A-1, P-2).
 */
export async function peshgiOutstanding(
  db: Db,
  args: { facilityId: string; book: BookType; partyId: string; asOf?: Date },
): Promise<number> {
  const sums = await partyBalances(db, {
    facilityId: args.facilityId,
    book: args.book,
    accounts: [SYSTEM_ACCOUNTS.PESHGI_LOANS],
    to: args.asOf,
    partyId: args.partyId,
  });
  const s = sums.get(args.partyId);
  return s ? round2(s.debit - s.credit) : 0;
}

/** Everything a party owes across both books, peshgi included — what a credit limit is measured against. */
export async function creditExposure(db: Db, facilityId: string, partyId: string): Promise<number> {
  const parts = await Promise.all(
    (['PACCI', 'KATCHI'] as const).flatMap((book) => [
      arBalances(db, { facilityId, book, partyId }).then((m) => m.get(partyId) ?? 0),
      peshgiOutstanding(db, { facilityId, book, partyId }),
    ]),
  );
  return sumMoney(parts);
}

export type OpenItem = {
  partyId: string;
  /** The invoice, or null for a line that is no document's (opening balance, manual). */
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
  // One statement, summed in the database. It used to load every receivable line the
  // store ever posted and add them up here, then name every invoice in one IN list:
  // seconds on a season of data, and a server error past 32,767 bills, the most bind
  // variables PostgreSQL takes (docs/31 F-0). Only what is still open comes back.
  //
  // The line filter is postedLinesWhere's: POSTED, in the book, up to the date. Raw
  // SQL is safe here: none of these tables is row-level secured. The day is passed as
  // text: a date column holds the UTC date part of what Prisma is given, and a Date
  // bound to raw SQL would be cast in the session's time zone instead.
  //
  // Every join's inner side is a table read through its index (invoices, and receipts
  // by invoice), never a second pass over a sub-result: with a client the planner has
  // no statistics for yet, that shape took over a minute for 33,000 bills.
  const asOf = toIsoDate(args.asOf);
  const partyId = args.partyId ?? null;
  const rows = await db.$queryRaw<
    { party_id: string; invoice_id: string | null; reference: string | null; date: Date; amount: unknown }[]
  >`
    WITH src AS (
      SELECT l.party_id, je.source_table, je.source_id,
             SUM(l.debit_amount - l.credit_amount) AS net,
             MIN(je.entry_date) AS date,
             MIN(je.entry_number) AS entry_number
      FROM journal_entry_lines l
      JOIN journal_entries je ON je.id = l.journal_entry_id
      WHERE l.facility_id = ${args.facilityId}::uuid
        AND je.posting_status = 'POSTED'
        AND je.book_type = ${args.book}::"BookType"
        AND je.entry_date <= ${asOf}::date
        AND l.account_code = ANY(${[...AR_CONTROL_ACCOUNTS]}::varchar[])
        AND l.party_id IS NOT NULL
        AND (${partyId}::uuid IS NULL OR l.party_id = ${partyId}::uuid)
        AND je.source_table <> 'payments'
      GROUP BY l.party_id, je.source_table, je.source_id
    ), doc AS (
      SELECT s.party_id, s.net, s.date, s.entry_number,
             CASE WHEN s.source_table = 'invoices' THEN s.source_id
                  WHEN s.source_table = 'credit_notes' THEN cn.original_invoice_id END AS invoice_id
      FROM src s
      LEFT JOIN credit_notes cn ON s.source_table = 'credit_notes' AND cn.id = s.source_id
    ), inv AS (
      SELECT d.invoice_id, SUM(d.net) AS net
      FROM doc d
      WHERE d.invoice_id IS NOT NULL
      GROUP BY d.invoice_id
    )
    SELECT i.billing_party_id AS party_id, i.id AS invoice_id, i.invoice_number AS reference, i.invoice_date AS date,
           bal.amount
    FROM inv
    JOIN invoices i ON i.id = inv.invoice_id
    CROSS JOIN LATERAL (
      SELECT inv.net - COALESCE(SUM(a.allocated_amount_pkr), 0) AS amount
      FROM payment_allocations a
      JOIN payments p ON p.id = a.payment_id
      WHERE a.invoice_id = inv.invoice_id AND a.voided_at IS NULL AND p.payment_date <= ${asOf}::date
    ) bal
    WHERE ABS(bal.amount) > 0.005
    UNION ALL
    SELECT d.party_id, NULL, d.entry_number, d.date, d.net
    FROM doc d
    WHERE d.invoice_id IS NULL AND ABS(d.net) > 0.005
  `;
  return rows
    .map((r) => ({ partyId: r.party_id, invoiceId: r.invoice_id, reference: r.reference, date: r.date, amountPkr: round2(Number(r.amount)) }))
    .filter((i) => Math.abs(i.amountPkr) > 0.005);
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
  if (je.entryType === 'LATE_PAYMENT_SURCHARGE') return 'SURCHARGE';
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

  const peshgi = await peshgiOutstanding(db, { facilityId: args.facilityId, book: args.book, partyId: args.partyId, asOf: args.to });
  return {
    opening_balance_pkr: round2(opening),
    entries: rows,
    total_debit_pkr: sumMoney(rows.map((r) => r.debit_pkr)),
    total_credit_pkr: sumMoney(rows.map((r) => r.credit_pkr)),
    closing_balance_pkr: round2(balance),
    // The rows above are the receivable accounts and tie to the ledger; peshgi is
    // owed as well, so the statement closes with it and the total.
    peshgi_outstanding_pkr: peshgi,
    total_owed_pkr: round2(balance + peshgi),
  };
}
