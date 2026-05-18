import type { PrismaClient, Prisma } from '@coldchain/db';
import { parseDateOnly, round2 } from '../helpers/money';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeasonalSummaryFilters {
  date_from: string;
  date_to: string;
  commodity_id?: string;
}

export async function getSeasonalSummary(
  prisma: PrismaClient,
  facilityId: string,
  filters: SeasonalSummaryFilters,
) {
  const fromDate = parseDateOnly(filters.date_from)!;
  const toDate = parseDateOnly(filters.date_to)!;
  const commodityFilter = filters.commodity_id
    ? { commodityId: filters.commodity_id }
    : {};

  const lotInboundWhere: Prisma.LotWhereInput = {
    facilityId,
    entryDate: { gte: fromDate, lte: toDate },
    ...commodityFilter,
  };
  const outboundWhere: Prisma.OutboundEventWhereInput = {
    facilityId,
    status: 'DISPATCHED',
    outboundDate: { gte: fromDate, lte: toDate },
    ...(filters.commodity_id ? { lot: { commodityId: filters.commodity_id } } : {}),
  };
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    facilityId,
    status: 'FINALIZED',
    invoiceDate: { gte: fromDate, lte: toDate },
    ...(filters.commodity_id ? { lot: { commodityId: filters.commodity_id } } : {}),
  };
  const closedLotsWhere: Prisma.LotWhereInput = {
    facilityId,
    closedAt: { gte: fromDate, lte: toDate },
    ...commodityFilter,
  };

  const [
    inboundAgg,
    outboundAgg,
    revenueAgg,
    closedLots,
    inboundByCommodity,
    outboundByCommodity,
    revenueByCommodity,
    commodityRows,
  ] = await Promise.all([
    prisma.lot.aggregate({ where: lotInboundWhere, _sum: { quantityBags: true } }),
    prisma.outboundEvent.aggregate({
      where: outboundWhere,
      _sum: { quantityWithdrawnBags: true },
    }),
    prisma.invoice.aggregate({ where: invoiceWhere, _sum: { totalPkr: true } }),
    prisma.lot.findMany({
      where: closedLotsWhere,
      select: { inboundDate: true, closedAt: true },
    }),
    prisma.lot.groupBy({
      by: ['commodityId'],
      where: lotInboundWhere,
      _sum: { quantityBags: true },
    }),
    prisma.outboundEvent.groupBy({
      by: ['lotId'],
      where: outboundWhere,
      _sum: { quantityWithdrawnBags: true },
    }),
    prisma.invoice.groupBy({
      by: ['lotId'],
      where: invoiceWhere,
      _sum: { totalPkr: true },
    }),
    prisma.commodity.findMany({
      select: { id: true, name: true },
    }),
  ]);

  // Resolve commodity for outbound/invoice groupings (they were grouped by lotId)
  const lotIdsForCommodity = Array.from(
    new Set([
      ...outboundByCommodity.map((g) => g.lotId),
      ...revenueByCommodity.map((g) => g.lotId),
    ]),
  );
  const lotsCommodity = lotIdsForCommodity.length
    ? await prisma.lot.findMany({
        where: { id: { in: lotIdsForCommodity } },
        select: { id: true, commodityId: true },
      })
    : [];
  const commodityForLot = new Map(lotsCommodity.map((l) => [l.id, l.commodityId]));

  const commodityById = new Map(commodityRows.map((c) => [c.id, c.name]));

  type CRow = {
    commodity_id: string;
    commodity_name: string;
    inbound_bags: number;
    outbound_bags: number;
    revenue_pkr: number;
  };
  const byCommodity = new Map<string, CRow>();
  function get(commodityId: string): CRow {
    let r = byCommodity.get(commodityId);
    if (!r) {
      r = {
        commodity_id: commodityId,
        commodity_name: commodityById.get(commodityId) ?? '(unknown)',
        inbound_bags: 0,
        outbound_bags: 0,
        revenue_pkr: 0,
      };
      byCommodity.set(commodityId, r);
    }
    return r;
  }
  for (const g of inboundByCommodity) {
    if (!g._sum.quantityBags) continue;
    get(g.commodityId).inbound_bags += g._sum.quantityBags;
  }
  for (const g of outboundByCommodity) {
    const cid = commodityForLot.get(g.lotId);
    if (!cid) continue;
    get(cid).outbound_bags += g._sum.quantityWithdrawnBags ?? 0;
  }
  for (const g of revenueByCommodity) {
    const cid = commodityForLot.get(g.lotId);
    if (!cid) continue;
    get(cid).revenue_pkr += Number(g._sum.totalPkr ?? 0);
  }

  let avgStorageDays: number | null = null;
  if (closedLots.length > 0) {
    const totalDays = closedLots.reduce((s, l) => {
      if (!l.closedAt) return s;
      return s + Math.max(0, Math.floor((l.closedAt.getTime() - l.inboundDate.getTime()) / DAY_MS));
    }, 0);
    avgStorageDays = round2(totalDays / closedLots.length);
  }

  return {
    period: {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10),
    },
    total_inbound_bags: inboundAgg._sum.quantityBags ?? 0,
    total_outbound_bags: outboundAgg._sum.quantityWithdrawnBags ?? 0,
    total_revenue_pkr: round2(Number(revenueAgg._sum.totalPkr ?? 0)),
    avg_storage_days: avgStorageDays,
    commodities: Array.from(byCommodity.values())
      .map((r) => ({
        ...r,
        revenue_pkr: round2(r.revenue_pkr),
      }))
      .sort((a, b) => a.commodity_name.localeCompare(b.commodity_name)),
  };
}
