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

  const buckets = emptyBuckets();
  const byParty = new Map<string, PartyRow>();

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
