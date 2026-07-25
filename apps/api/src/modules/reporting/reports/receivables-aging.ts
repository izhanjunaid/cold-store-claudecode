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
  unapplied_credit_pkr: number;
  net_due_pkr: number;
}

// GL AR control accounts (party receivables). 1140 Peshgi is a separate loan
// control and is deliberately excluded.
const AR_CONTROL_ACCOUNTS = ['1110', '1120', '1130', '1150'];

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

  // On-account (unallocated) receipts reduce a party's GL AR for the full
  // receipt (JE-02) but never touch invoice amountPaidPkr. Fetch them
  // unconditionally so they reduce the party's net receivable, not only their
  // opening balance — otherwise aging overstates against the balance sheet
  // (phase/19 audit item 5).
  const onAccountPayments = await prisma.payment.findMany({
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
  });

  const onAccountByParty = new Map<string, number>();
  for (const pay of onAccountPayments) {
    const allocated = pay.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
    const unallocated = Math.max(0, Number(pay.amountPkr) - allocated);
    if (unallocated > 0) {
      onAccountByParty.set(pay.partyId, (onAccountByParty.get(pay.partyId) ?? 0) + unallocated);
    }
  }
  // Credit remaining after opening balances have absorbed their share; the
  // leftover reduces invoice-based dues (tracked as unapplied credit).
  const remainingCredit = new Map(onAccountByParty);

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
    // On-account credit absorbs the opening balance first (same FIFO as before);
    // whatever it can't cover here stays as unapplied credit for the invoices.
    const grossOpening = Math.max(0, opening.net);
    const credit = remainingCredit.get(pid) ?? 0;
    const applied = Math.min(credit, grossOpening);
    remainingCredit.set(pid, credit - applied);
    const due = round2(grossOpening - applied);
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
      unapplied_credit_pkr: 0,
      net_due_pkr: 0,
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
        unapplied_credit_pkr: 0,
        net_due_pkr: 0,
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

  // Late-payment surcharges (JE-21) debit the party AR control but are not
  // invoices, so include them here — bucketed by their entry date — to keep the
  // aging reconciled with the GL once surcharges exist (phase/19 audit).
  const surchargeLines = await prisma.journalEntryLine.findMany({
    where: {
      facilityId,
      partyId: filters.party_id ?? { not: null },
      accountCode: { in: AR_CONTROL_ACCOUNTS },
      journalEntry: {
        facilityId,
        sourceTable: 'invoice_surcharge',
        postingStatus: 'POSTED',
        bookType: 'PACCI',
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
  for (const line of surchargeLines) {
    if (!line.party) continue;
    const amt = round2(Number(line.debitAmount) - Number(line.creditAmount));
    if (amt <= 0.005) continue;
    const key = bucketFor(asOfDate, line.journalEntry.entryDate);
    buckets[key] += amt;
    buckets.total_pkr += amt;
    let row = byParty.get(line.party.id);
    if (!row) {
      row = {
        party_id: line.party.id,
        party_name: line.party.name,
        party_type: line.party.partyType,
        total_due_pkr: 0,
        b_0_30: 0,
        b_31_60: 0,
        b_61_90: 0,
        b_90_plus: 0,
        oldest_invoice_days: 0,
        unapplied_credit_pkr: 0,
        net_due_pkr: 0,
      };
      byParty.set(line.party.id, row);
    }
    row[key as Exclude<AgingBucketKey, never>] += amt;
    row.total_due_pkr += amt;
    row.oldest_invoice_days = Math.max(row.oldest_invoice_days, ageInDays(asOfDate, line.journalEntry.entryDate));
  }

  // Parties whose only activity is an unapplied credit (payment with nothing to
  // apply it to) carry a true credit balance — show it as negative net due so
  // the aging reconciles with the GL AR control.
  for (const [pid, credit] of remainingCredit) {
    const leftover = round2(credit);
    if (leftover <= 0.005) continue;
    const existing = byParty.get(pid);
    if (existing) {
      existing.unapplied_credit_pkr += leftover;
    } else {
      byParty.set(pid, {
        party_id: pid,
        party_name: '',
        party_type: '',
        total_due_pkr: 0,
        b_0_30: 0,
        b_31_60: 0,
        b_61_90: 0,
        b_90_plus: 0,
        oldest_invoice_days: 0,
        unapplied_credit_pkr: leftover,
        net_due_pkr: 0,
      });
    }
  }

  // Backfill names for pure-credit rows.
  const nameless = Array.from(byParty.values()).filter((r) => r.party_name === '');
  if (nameless.length) {
    const found = await prisma.party.findMany({
      where: { facilityId, id: { in: nameless.map((r) => r.party_id) } },
      select: { id: true, name: true, partyType: true },
    });
    const nameMap = new Map(found.map((p) => [p.id, p]));
    for (const r of nameless) {
      const p = nameMap.get(r.party_id);
      if (p) {
        r.party_name = p.name;
        r.party_type = p.partyType;
      }
    }
  }

  const roundedBuckets = {
    b_0_30: round2(buckets.b_0_30),
    b_31_60: round2(buckets.b_31_60),
    b_61_90: round2(buckets.b_61_90),
    b_90_plus: round2(buckets.b_90_plus),
    total_pkr: round2(buckets.total_pkr),
  };

  const allParties: PartyRow[] = Array.from(byParty.values())
    .map((r) => {
      const total_due_pkr = round2(r.total_due_pkr);
      const unapplied_credit_pkr = round2(r.unapplied_credit_pkr);
      return {
        ...r,
        total_due_pkr,
        b_0_30: round2(r.b_0_30),
        b_31_60: round2(r.b_31_60),
        b_61_90: round2(r.b_61_90),
        b_90_plus: round2(r.b_90_plus),
        unapplied_credit_pkr,
        net_due_pkr: round2(total_due_pkr - unapplied_credit_pkr),
      };
    })
    .sort((a, b) => b.net_due_pkr - a.net_due_pkr);

  const total_unapplied_credit_pkr = round2(
    allParties.reduce((s, r) => s + r.unapplied_credit_pkr, 0),
  );
  const net_total_pkr = round2(roundedBuckets.total_pkr - total_unapplied_credit_pkr);

  // GL tie-out: the balance-sheet Trade Receivables comes from the AR control
  // accounts. Surface the control total and the variance so a divergence is
  // visible rather than silent (docs claimed automatic reconciliation).
  const glAgg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId,
      accountCode: { in: AR_CONTROL_ACCOUNTS },
      ...(filters.party_id ? { partyId: filters.party_id } : {}),
      journalEntry: {
        facilityId,
        postingStatus: 'POSTED',
        bookType: 'PACCI',
        entryDate: { lte: asOfDate },
      },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  const gl_ar_control_total_pkr = round2(
    Number(glAgg._sum.debitAmount ?? 0) - Number(glAgg._sum.creditAmount ?? 0),
  );
  const variance_pkr = round2(net_total_pkr - gl_ar_control_total_pkr);
  const reconciled = Math.abs(variance_pkr) < 0.01;

  const page = filters.page ?? 1;
  const perPage = filters.per_page ?? 50;
  const total = allParties.length;
  const parties = allParties.slice((page - 1) * perPage, page * perPage);

  return {
    as_of_date: asOfDate.toISOString().slice(0, 10),
    buckets: roundedBuckets,
    total_unapplied_credit_pkr,
    net_total_pkr,
    gl_ar_control_total_pkr,
    variance_pkr,
    reconciled,
    parties,
    meta: { page, per_page: perPage, total },
  };
}
