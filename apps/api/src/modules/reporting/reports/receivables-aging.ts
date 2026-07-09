import type { PrismaClient } from '@coldchain/db';
import {
  bucketFor,
  emptyBuckets,
  ageInDays,
  type AgingBucketKey,
} from '../helpers/aging-buckets';
import { parseDateOnly, round2, startOfToday } from '../helpers/money';

export interface ReceivablesAgingFilters {
  as_of_date?: string;
  party_id?: string;
  page?: number;
  per_page?: number;
}

interface PartyRow {
  party_id: string;
  party_name: string;
  party_type: string;
  total_due_pkr: number;
  b_0_30: number;
  b_31_60: number;
  b_61_90: number;
  b_90_plus: number;
  oldest_invoice_days: number;
}

export async function getReceivablesAging(
  prisma: PrismaClient,
  facilityId: string,
  filters: ReceivablesAgingFilters,
) {
  const asOfDate = parseDateOnly(filters.as_of_date) ?? startOfToday();

  const invoices = await prisma.invoice.findMany({
    where: {
      facilityId,
      status: 'FINALIZED',
      ...(filters.party_id ? { billingPartyId: filters.party_id } : {}),
    },
    select: {
      invoiceDate: true,
      totalPkr: true,
      amountPaidPkr: true,
      billingPartyId: true,
      billingParty: { select: { id: true, name: true, partyType: true } },
    },
  });

  // Opening balances (audit Gap 1): per-party opening AR from the opening
  // journal entry, settled FIFO by the unallocated (on-account) portion of
  // payments — the same treatment JE-02 gives them in the GL, so aging
  // stays reconciled with the receivable accounts.
  const openingLines = await prisma.journalEntryLine.findMany({
    where: {
      facilityId,
      partyId: filters.party_id ?? { not: null },
      journalEntry: {
        facilityId,
        sourceTable: 'opening_balances',
        postingStatus: 'POSTED',
        entryDate: { lte: asOfDate },
      },
    },
    select: {
      debitAmount: true,
      creditAmount: true,
      party: { select: { id: true, name: true, partyType: true } },
      journalEntry: { select: { entryDate: true } },
    },
  });

  const onAccountPayments = openingLines.length
    ? await prisma.payment.findMany({
        where: {
          facilityId,
          ...(filters.party_id ? { partyId: filters.party_id } : {}),
          isAdvance: false,
          status: { not: 'DISHONOURED' },
          paymentDate: { lte: asOfDate },
        },
        select: {
          partyId: true,
          amountPkr: true,
          allocations: { where: { voidedAt: null }, select: { allocatedAmountPkr: true } },
        },
      })
    : [];

  const onAccountByParty = new Map<string, number>();
  for (const pay of onAccountPayments) {
    const allocated = pay.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
    const unallocated = Math.max(0, Number(pay.amountPkr) - allocated);
    if (unallocated > 0) {
      onAccountByParty.set(pay.partyId, (onAccountByParty.get(pay.partyId) ?? 0) + unallocated);
    }
  }

  const openingByParty = new Map<
    string,
    { net: number; date: Date; party: { id: string; name: string; partyType: string } }
  >();
  for (const line of openingLines) {
    if (!line.party) continue;
    const cur = openingByParty.get(line.party.id);
    const delta = Number(line.debitAmount) - Number(line.creditAmount);
    if (cur) {
      cur.net += delta;
      if (line.journalEntry.entryDate < cur.date) cur.date = line.journalEntry.entryDate;
    } else {
      openingByParty.set(line.party.id, { net: delta, date: line.journalEntry.entryDate, party: line.party });
    }
  }

  const buckets = emptyBuckets();
  const byParty = new Map<string, PartyRow>();

  for (const [pid, opening] of openingByParty) {
    const due = round2(Math.max(0, opening.net - (onAccountByParty.get(pid) ?? 0)));
    if (due <= 0.005) continue;

    const key = bucketFor(asOfDate, opening.date);
    buckets[key] += due;
    buckets.total_pkr += due;

    byParty.set(pid, {
      party_id: opening.party.id,
      party_name: opening.party.name,
      party_type: opening.party.partyType,
      total_due_pkr: due,
      b_0_30: 0,
      b_31_60: 0,
      b_61_90: 0,
      b_90_plus: 0,
      oldest_invoice_days: ageInDays(asOfDate, opening.date),
      [key]: due,
    } as PartyRow);
  }

  for (const inv of invoices) {
    const due = Number(inv.totalPkr) - Number(inv.amountPaidPkr);
    if (due <= 0.005) continue;

    const key = bucketFor(asOfDate, inv.invoiceDate);
    buckets[key] += due;
    buckets.total_pkr += due;

    let row = byParty.get(inv.billingPartyId);
    if (!row) {
      row = {
        party_id: inv.billingParty.id,
        party_name: inv.billingParty.name,
        party_type: inv.billingParty.partyType,
        total_due_pkr: 0,
        b_0_30: 0,
        b_31_60: 0,
        b_61_90: 0,
        b_90_plus: 0,
        oldest_invoice_days: 0,
      };
      byParty.set(inv.billingPartyId, row);
    }
    row[key as Exclude<AgingBucketKey, never>] += due;
    row.total_due_pkr += due;
    row.oldest_invoice_days = Math.max(
      row.oldest_invoice_days,
      ageInDays(asOfDate, inv.invoiceDate),
    );
  }

  const roundedBuckets = {
    b_0_30: round2(buckets.b_0_30),
    b_31_60: round2(buckets.b_31_60),
    b_61_90: round2(buckets.b_61_90),
    b_90_plus: round2(buckets.b_90_plus),
    total_pkr: round2(buckets.total_pkr),
  };

  const allParties: PartyRow[] = Array.from(byParty.values())
    .map((r) => ({
      ...r,
      total_due_pkr: round2(r.total_due_pkr),
      b_0_30: round2(r.b_0_30),
      b_31_60: round2(r.b_31_60),
      b_61_90: round2(r.b_61_90),
      b_90_plus: round2(r.b_90_plus),
    }))
    .sort((a, b) => b.total_due_pkr - a.total_due_pkr);

  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  const total = allParties.length;
  const parties = allParties.slice((page - 1) * perPage, page * perPage);

  return {
    as_of_date: asOfDate.toISOString().slice(0, 10),
    buckets: roundedBuckets,
    parties,
    meta: { page, per_page: perPage, total },
  };
}
