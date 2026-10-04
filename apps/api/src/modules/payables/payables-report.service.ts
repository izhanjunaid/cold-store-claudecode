import type { PrismaClient, Prisma } from '@coldchain/db';
import { MONEY_EPSILON, round2, sumMoney, toIsoDate, type SupplierStatementQueryType } from '@coldchain/shared';
import { accountBalances, partyBalances, postedLinesWhere } from '../accounting/ledger';
import { postedEntryNumber } from '../accounting/journal-entry.service';
import { AP_CONTROL_ACCOUNTS, payableSupplier } from './supplier';

type Book = 'PACCI' | 'KATCHI';

/** Lines no bill or supplier payment posted: opening balances, manual corrections. */
const DOCUMENT_SOURCES = ['bills', 'supplier_payments'];

const BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'] as const;
type Bucket = (typeof BUCKETS)[number];

function bucketFor(daysOverdue: number): Bucket {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'days_1_30';
  if (daysOverdue <= 60) return 'days_31_60';
  if (daysOverdue <= 90) return 'days_61_90';
  return 'days_over_90';
}

const credit = (s: { debit: number; credit: number } | undefined) => (s ? round2(s.credit - s.debit) : 0);

/**
 * The payables read model (docs/25 §2 invariant 5): one answer to "what do we owe each
 * supplier", read from the ledger, with the documents behind it as open items. For
 * every supplier, open bills − unapplied payments + other lines = the control account,
 * by construction; the tie-out reports any difference rather than hiding it.
 *
 * ponytail: current state only (no as-of date) — aging a past date needs each void's
 * reversal date; add when someone asks for a dated aging.
 */
export class PayablesReportService {
  constructor(private prisma: PrismaClient) {}

  async aging(facilityId: string, book: Book) {
    const today = toIsoDate(new Date());
    const nonDocument: Prisma.JournalEntryLineWhereInput = {
      AND: [postedLinesWhere({ facilityId, book }), { journalEntry: { sourceTable: { notIn: DOCUMENT_SOURCES } } }],
      accountCode: { in: [...AP_CONTROL_ACCOUNTS] },
      partyId: { not: null },
    };

    const [gl, glTotal, otherRows, bills, payments] = await Promise.all([
      partyBalances(this.prisma, { facilityId, book, accounts: AP_CONTROL_ACCOUNTS }),
      accountBalances(this.prisma, { facilityId, book, accounts: [...AP_CONTROL_ACCOUNTS] }),
      this.prisma.journalEntryLine.groupBy({
        by: ['partyId'],
        where: nonDocument,
        _sum: { debitAmount: true, creditAmount: true },
      }),
      this.prisma.bill.findMany({
        where: { facilityId, bookType: book, status: 'POSTED' },
        select: { supplierPartyId: true, billDate: true, dueDate: true, totalPkr: true, allocations: true },
      }),
      this.prisma.supplierPayment.findMany({
        where: { facilityId, bookType: book, voidedAt: null },
        select: { supplierPartyId: true, grossAmountPkr: true, allocations: true },
      }),
    ]);

    type Acc = Record<Bucket, number> & { open: number; unapplied: number };
    const rows = new Map<string, Acc>();
    const row = (partyId: string) => {
      let r = rows.get(partyId);
      if (!r) {
        r = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, open: 0, unapplied: 0 };
        rows.set(partyId, r);
      }
      return r;
    };
    const live = (allocations: Array<{ voidedAt: Date | null; allocatedAmountPkr: unknown }>) =>
      sumMoney(allocations.filter((a) => !a.voidedAt).map((a) => Number(a.allocatedAmountPkr)));

    for (const b of bills) {
      const open = round2(Number(b.totalPkr) - live(b.allocations));
      if (open <= MONEY_EPSILON) continue;
      const due = toIsoDate(b.dueDate ?? b.billDate);
      const overdue = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
      const r = row(b.supplierPartyId);
      r[bucketFor(overdue)] = round2(r[bucketFor(overdue)] + open);
      r.open = round2(r.open + open);
    }
    for (const p of payments) {
      const unapplied = round2(Number(p.grossAmountPkr) - live(p.allocations));
      if (unapplied > MONEY_EPSILON) row(p.supplierPartyId).unapplied = round2(row(p.supplierPartyId).unapplied + unapplied);
    }
    const other = new Map(
      otherRows.map((o) => [
        o.partyId as string,
        round2(Number(o._sum.creditAmount ?? 0) - Number(o._sum.debitAmount ?? 0)),
      ]),
    );
    for (const id of [...gl.keys(), ...other.keys()]) row(id);

    const parties = await this.prisma.party.findMany({
      where: { facilityId, id: { in: [...rows.keys()] } },
      select: { id: true, name: true },
    });
    const names = new Map(parties.map((p) => [p.id, p.name]));

    const suppliers = [...rows.entries()]
      .map(([partyId, r]) => {
        const otherPkr = other.get(partyId) ?? 0;
        const balance = round2(r.open - r.unapplied + otherPkr);
        return {
          party_id: partyId,
          party_name: names.get(partyId) ?? '',
          ...Object.fromEntries(BUCKETS.map((k) => [k, r[k]])),
          open_bills_pkr: r.open,
          unapplied_payments_pkr: r.unapplied,
          other_pkr: otherPkr,
          balance_pkr: balance,
          gl_balance_pkr: credit(gl.get(partyId)),
        };
      })
      .filter((s) => s.open_bills_pkr || s.unapplied_payments_pkr || s.other_pkr || s.gl_balance_pkr)
      .sort((a, b) => b.balance_pkr - a.balance_pkr);

    const subLedger = sumMoney(suppliers.map((s) => s.balance_pkr));
    const glAll = sumMoney(AP_CONTROL_ACCOUNTS.map((code) => credit(glTotal.get(code))));
    return {
      suppliers,
      totals: {
        ...Object.fromEntries(BUCKETS.map((k) => [k, sumMoney(suppliers.map((s) => (s as unknown as Record<Bucket, number>)[k]))])),
        open_bills_pkr: sumMoney(suppliers.map((s) => s.open_bills_pkr)),
        unapplied_payments_pkr: sumMoney(suppliers.map((s) => s.unapplied_payments_pkr)),
        other_pkr: sumMoney(suppliers.map((s) => s.other_pkr)),
        balance_pkr: subLedger,
      },
      tie_out: {
        gl_payables_pkr: glAll,
        sub_ledger_pkr: subLedger,
        difference_pkr: round2(glAll - subLedger),
        is_reconciled: Math.abs(glAll - subLedger) < MONEY_EPSILON,
      },
    };
  }

  /** A supplier's account: every line on the payable controls with a running balance, and the bills still open. */
  async statement(facilityId: string, partyId: string, book: Book, query: SupplierStatementQueryType) {
    const supplier = await payableSupplier(this.prisma, facilityId, partyId, 'party_id');
    const from = query.date_from ? new Date(`${query.date_from}T00:00:00.000Z`) : undefined;
    const to = query.date_to ? new Date(`${query.date_to}T00:00:00.000Z`) : undefined;
    const onAccount = { accountCode: { in: [...AP_CONTROL_ACCOUNTS] }, partyId };

    const [opening, lines, bills] = await Promise.all([
      from
        ? this.prisma.journalEntryLine.aggregate({
            where: {
              ...postedLinesWhere({ facilityId, book, to: new Date(from.getTime() - 86_400_000) }),
              ...onAccount,
            },
            _sum: { debitAmount: true, creditAmount: true },
          })
        : null,
      this.prisma.journalEntryLine.findMany({
        where: { ...postedLinesWhere({ facilityId, book, from, to }), ...onAccount },
        include: { journalEntry: { select: { entryNumber: true, entryDate: true, description: true, sourceTable: true, sourceId: true, createdAt: true } } },
      }),
      this.prisma.bill.findMany({
        where: { facilityId, bookType: book, status: 'POSTED', supplierPartyId: partyId },
        include: { allocations: true },
        orderBy: { billDate: 'asc' },
      }),
    ]);

    lines.sort(
      (a, b) =>
        a.journalEntry.entryDate.getTime() - b.journalEntry.entryDate.getTime() ||
        a.journalEntry.createdAt.getTime() - b.journalEntry.createdAt.getTime(),
    );
    const openingBalance = opening
      ? round2(Number(opening._sum.creditAmount ?? 0) - Number(opening._sum.debitAmount ?? 0))
      : 0;
    let running = openingBalance;
    const rows = lines.map((l) => {
      running = round2(running + Number(l.creditAmount) - Number(l.debitAmount));
      return {
        date: toIsoDate(l.journalEntry.entryDate),
        entry_number: postedEntryNumber(l.journalEntry),
        description: l.description ?? l.journalEntry.description,
        source_table: l.journalEntry.sourceTable,
        source_id: l.journalEntry.sourceId,
        debit_pkr: Number(l.debitAmount),
        credit_pkr: Number(l.creditAmount),
        running_balance_pkr: running,
      };
    });

    return {
      party_id: supplier.id,
      party_name: supplier.name,
      date_from: query.date_from ?? null,
      date_to: query.date_to ?? null,
      opening_balance_pkr: openingBalance,
      lines: rows,
      closing_balance_pkr: running,
      open_bills: bills
        .map((b) => {
          const paid = sumMoney(b.allocations.filter((a) => !a.voidedAt).map((a) => Number(a.allocatedAmountPkr)));
          return {
            id: b.id,
            bill_number: b.billNumber,
            bill_date: toIsoDate(b.billDate),
            due_date: b.dueDate ? toIsoDate(b.dueDate) : null,
            total_pkr: Number(b.totalPkr),
            open_pkr: round2(Number(b.totalPkr) - paid),
          };
        })
        .filter((b) => b.open_pkr > MONEY_EPSILON),
    };
  }
}
