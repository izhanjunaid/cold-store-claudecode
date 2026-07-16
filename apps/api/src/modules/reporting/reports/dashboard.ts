import type { PrismaClient } from '@coldchain/db';
import { daysInStorage } from '../helpers/days-in-storage';
import { round2, startOfToday } from '../helpers/money';
import { getReceivablesAging } from './receivables-aging';

const FINANCIAL_MIN_ROLE_RANK = 4; // ACCOUNTANT
const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

const DEFAULT_STORAGE_ALERT_DAYS = 90;
const ATTENTION_LIMIT = 20;

export async function getDashboard(
  prisma: PrismaClient,
  facilityId: string,
  userRole: string,
) {
  const today = startOfToday();
  const userRank = ROLE_RANK[userRole] ?? 0;
  const includeFinancial = userRank >= FINANCIAL_MIN_ROLE_RANK;

  const [
    activeLotsCount,
    bagsAgg,
    todayInboundAgg,
    todayOutboundAgg,
    chamberRows,
    activeLots,
  ] = await Promise.all([
    prisma.lot.count({ where: { facilityId, status: 'ACTIVE' } }),
    prisma.lot.aggregate({
      where: { facilityId, status: 'ACTIVE' },
      _sum: { currentBalanceBags: true },
    }),
    prisma.lot.aggregate({
      where: { facilityId, entryDate: today },
      _sum: { quantityBags: true },
    }),
    prisma.outboundEvent.aggregate({
      where: { facilityId, outboundDate: today, status: 'DISPATCHED' },
      _sum: { quantityWithdrawnBags: true },
    }),
    prisma.chamber.findMany({
      where: { facilityId, isActive: true },
      select: {
        id: true,
        name: true,
        maxCapacityBags: true,
        lots: {
          where: { status: 'ACTIVE' },
          select: { currentBalanceBags: true },
        },
      },
    }),
    prisma.lot.findMany({
      where: { facilityId, status: 'ACTIVE' },
      select: {
        id: true,
        lotNumber: true,
        currentBalanceBags: true,
        inboundDate: true,
        commodity: { select: { name: true, defaultStorageDaysAlert: true } },
        ownerParty: { select: { name: true } },
      },
    }),
  ]);

  const totalBags = bagsAgg._sum.currentBalanceBags ?? 0;
  const chambers = chamberRows.map((c) => {
    const bags = c.lots.reduce((s, l) => s + l.currentBalanceBags, 0);
    const capacity = c.maxCapacityBags;
    const occupancy_pct = capacity > 0 ? round2((bags / capacity) * 100) : 0;
    return { id: c.id, name: c.name, bags, capacity, occupancy_pct };
  });
  const totalCapacity = chambers.reduce((s, c) => s + c.capacity, 0);
  const occupancyPct = totalCapacity > 0 ? round2((totalBags / totalCapacity) * 100) : 0;

  const attentionCandidates = activeLots
    .map((lot) => {
      const threshold = lot.commodity.defaultStorageDaysAlert ?? DEFAULT_STORAGE_ALERT_DAYS;
      const days = daysInStorage(lot.inboundDate, today);
      return {
        lot_id: lot.id,
        lot_number: lot.lotNumber,
        owner_name: lot.ownerParty.name,
        commodity_name: lot.commodity.name,
        current_bags: lot.currentBalanceBags,
        days_in_storage: days,
        threshold,
        exceeded: days > threshold,
      };
    })
    .filter((row) => row.exceeded)
    .sort((a, b) => b.days_in_storage - a.days_in_storage)
    .slice(0, ATTENTION_LIMIT)
    .map(({ exceeded: _exceeded, ...keep }) => keep);

  let financial: {
    ar_total_pkr: number;
    collected_today_pkr: number;
    overdue_90_plus_pkr: number;
  } | null = null;

  let unbilledInvoices: {
    count: number;
    total_pkr: number;
    items: Array<{
      invoice_id: string;
      lot_number: string;
      billing_party_name: string;
      total_pkr: number;
      invoice_date: string;
      source: 'DISPATCH' | 'TRANSFER';
    }>;
  } | null = null;

  if (includeFinancial) {
    const [arRows, collectedAgg, aging, draftInvoices] = await Promise.all([
      prisma.$queryRaw<{ ar_total: string | null }[]>`
        SELECT COALESCE(SUM(total_pkr - amount_paid_pkr), 0)::text AS ar_total
        FROM invoices
        WHERE facility_id = ${facilityId}::uuid
          AND status = 'FINALIZED'
          AND total_pkr > amount_paid_pkr
      `,
      prisma.payment.aggregate({
        where: {
          facilityId,
          paymentDate: today,
          status: { not: 'DISHONOURED' },
        },
        _sum: { amountPkr: true },
      }),
      getReceivablesAging(prisma, facilityId, {}),
      // DRAFT invoices already represent money owed with no AR/JE-01 posted
      // yet. outboundEventId set = goods already dispatched, waiting on the
      // accountant to finalize; null = a FULL ownership transfer's accrued
      // invoice for the outgoing owner (see buildOwnershipTransferAccruedInvoice),
      // which has no outbound event to key off of at all.
      prisma.invoice.findMany({
        where: { facilityId, status: 'DRAFT' },
        select: {
          id: true,
          outboundEventId: true,
          totalPkr: true,
          invoiceDate: true,
          lot: { select: { lotNumber: true } },
          billingParty: { select: { name: true } },
        },
        orderBy: { invoiceDate: 'asc' },
        take: ATTENTION_LIMIT,
      }),
    ]);

    const arTotal = Number(arRows[0]?.ar_total ?? 0);
    financial = {
      ar_total_pkr: round2(arTotal),
      collected_today_pkr: round2(Number(collectedAgg._sum.amountPkr ?? 0)),
      overdue_90_plus_pkr: round2(aging.buckets.b_90_plus),
    };

    const unbilledTotalAgg = await prisma.invoice.aggregate({
      where: { facilityId, status: 'DRAFT' },
      _sum: { totalPkr: true },
      _count: true,
    });
    unbilledInvoices = {
      count: unbilledTotalAgg._count,
      total_pkr: round2(Number(unbilledTotalAgg._sum.totalPkr ?? 0)),
      items: draftInvoices.map((inv) => ({
        invoice_id: inv.id,
        lot_number: inv.lot.lotNumber,
        billing_party_name: inv.billingParty.name,
        total_pkr: Number(inv.totalPkr),
        invoice_date: inv.invoiceDate.toISOString().slice(0, 10),
        source: inv.outboundEventId ? 'DISPATCH' : 'TRANSFER',
      })),
    };
  }

  return {
    active_lots: activeLotsCount,
    total_bags: totalBags,
    occupancy_pct: occupancyPct,
    today_inbound_bags: Number(todayInboundAgg._sum.quantityBags ?? 0),
    today_outbound_bags: Number(todayOutboundAgg._sum.quantityWithdrawnBags ?? 0),
    chambers,
    attention_required: attentionCandidates,
    financial,
    unbilled_invoices: unbilledInvoices,
  };
}
