import type { PrismaClient, BookType } from '@coldchain/db';
import { AR_CONTROL_ACCOUNTS, round2, sumMoney } from '@coldchain/shared';
import { accountBalances } from '../../accounting/ledger';
import { bucketFor, emptyBuckets, ageInDays, type AgingBucketKey } from '../helpers/aging-buckets';
import { parseDateOnly, startOfToday } from '../helpers/money';
import { arBalances, openItems } from '../../invoice/receivables';

export interface ReceivablesAgingFilters {
  as_of_date?: string;
  party_id?: string;
  /** Each book is aged on its own; the official book unless asked. */
  book_type?: BookType;
  page?: number;
  per_page?: number;
}

type PartyRow = {
  party_id: string;
  party_name: string;
  party_type: string;
  total_due_pkr: number;
  b_0_30: number;
  b_31_60: number;
  b_61_90: number;
  b_90_plus: number;
  oldest_invoice_days: number;
  unapplied_credit_pkr: number;
  net_due_pkr: number;
};

/**
 * Receivables aging, true as of its date, from the AR read model (docs/25 R-10):
 * open invoices and lines no document owns, bucketed by date; whatever the GL
 * balance holds beyond them is the party's unapplied credit. Each party's net
 * due is its GL balance, so the report total IS the AR control balance.
 */
export async function getReceivablesAging(
  prisma: PrismaClient,
  facilityId: string,
  filters: ReceivablesAgingFilters,
) {
  const asOfDate = parseDateOnly(filters.as_of_date) ?? startOfToday();
  const book = filters.book_type ?? 'PACCI';
  const scope = { facilityId, book, asOf: asOfDate, partyId: filters.party_id };
  const [balances, items] = await Promise.all([arBalances(prisma, scope), openItems(prisma, scope)]);

  const partyIds = [...new Set([...balances.keys(), ...items.map((i) => i.partyId)])];
  const parties = await prisma.party.findMany({
    where: { facilityId, id: { in: partyIds } },
    select: { id: true, name: true, partyType: true },
  });
  const partyById = new Map(parties.map((p) => [p.id, p]));

  const buckets = emptyBuckets();
  const rows = new Map<string, PartyRow>();
  const rowFor = (partyId: string): PartyRow => {
    let row = rows.get(partyId);
    if (!row) {
      const p = partyById.get(partyId);
      row = {
        party_id: partyId,
        party_name: p?.name ?? '',
        party_type: p?.partyType ?? '',
        total_due_pkr: 0,
        b_0_30: 0,
        b_31_60: 0,
        b_61_90: 0,
        b_90_plus: 0,
        oldest_invoice_days: 0,
        unapplied_credit_pkr: 0,
        net_due_pkr: 0,
      };
      rows.set(partyId, row);
    }
    return row;
  };

  for (const item of items) {
    const key: AgingBucketKey = bucketFor(asOfDate, item.date);
    const row = rowFor(item.partyId);
    row[key] += item.amountPkr;
    row.total_due_pkr += item.amountPkr;
    buckets[key] += item.amountPkr;
    buckets.total_pkr += item.amountPkr;
    if (item.amountPkr > 0) row.oldest_invoice_days = Math.max(row.oldest_invoice_days, ageInDays(asOfDate, item.date));
  }
  for (const [partyId, balance] of balances) {
    const row = rowFor(partyId);
    row.net_due_pkr = balance;
    row.unapplied_credit_pkr = round2(row.total_due_pkr - balance);
  }

  const allParties = [...rows.values()]
    .map((r) => ({
      ...r,
      total_due_pkr: round2(r.total_due_pkr),
      b_0_30: round2(r.b_0_30),
      b_31_60: round2(r.b_31_60),
      b_61_90: round2(r.b_61_90),
      b_90_plus: round2(r.b_90_plus),
      unapplied_credit_pkr: round2(r.unapplied_credit_pkr),
      net_due_pkr: round2(r.net_due_pkr),
    }))
    .filter((r) => Math.abs(r.net_due_pkr) > 0.005 || Math.abs(r.total_due_pkr) > 0.005)
    .sort((a, b) => b.net_due_pkr - a.net_due_pkr);

  // The tie-out reads the control accounts themselves, lines with no party included:
  // a variance is AR the sub-ledger cannot attribute (pre-update check C02).
  const control = filters.party_id
    ? null
    : await accountBalances(prisma, { facilityId, book, to: asOfDate, accounts: [...AR_CONTROL_ACCOUNTS] });
  const gl_ar_control_total_pkr = control
    ? sumMoney([...control.values()].map((s) => s.debit - s.credit))
    : sumMoney(balances.values());
  const net_total_pkr = sumMoney(allParties.map((r) => r.net_due_pkr));
  const variance_pkr = round2(net_total_pkr - gl_ar_control_total_pkr);

  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  return {
    as_of_date: asOfDate.toISOString().slice(0, 10),
    book_type: book,
    buckets: {
      b_0_30: round2(buckets.b_0_30),
      b_31_60: round2(buckets.b_31_60),
      b_61_90: round2(buckets.b_61_90),
      b_90_plus: round2(buckets.b_90_plus),
      total_pkr: round2(buckets.total_pkr),
    },
    total_unapplied_credit_pkr: sumMoney(allParties.map((r) => r.unapplied_credit_pkr)),
    net_total_pkr,
    gl_ar_control_total_pkr,
    variance_pkr,
    reconciled: Math.abs(variance_pkr) < 0.005,
    parties: allParties.slice((page - 1) * perPage, page * perPage),
    meta: { page, per_page: perPage, total: allParties.length },
  };
}
