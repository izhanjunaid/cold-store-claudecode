import type { PrismaClient, Prisma } from '@coldchain/db';
import { parseDateOnly, round2 } from '../helpers/money';

export interface WeightVarianceFilters {
  date_from?: string;
  date_to?: string;
  lot_id?: string;
  page: number;
  per_page: number;
}

export async function getWeightVariance(
  prisma: PrismaClient,
  facilityId: string,
  filters: WeightVarianceFilters,
) {
  const fromDate = parseDateOnly(filters.date_from);
  const toDate = parseDateOnly(filters.date_to);

  const outboundDateFilter: Prisma.DateTimeFilter = {};
  if (fromDate) outboundDateFilter.gte = fromDate;
  if (toDate) outboundDateFilter.lte = toDate;
  const hasDateFilter = fromDate !== undefined || toDate !== undefined;

  const lotWhere: Prisma.LotWhereInput = {
    facilityId,
    outboundEvents: {
      some: {
        status: 'DISPATCHED',
        ...(hasDateFilter ? { outboundDate: outboundDateFilter } : {}),
      },
    },
  };
  if (filters.lot_id) lotWhere.id = filters.lot_id;

  const skip = (filters.page - 1) * filters.per_page;

  const [total, lots] = await Promise.all([
    prisma.lot.count({ where: lotWhere }),
    prisma.lot.findMany({
      where: lotWhere,
      orderBy: [{ inboundDate: 'desc' }],
      skip,
      take: filters.per_page,
      select: {
        id: true,
        lotNumber: true,
        quantityBags: true,
        acceptedWeightKg: true,
        ownerParty: { select: { name: true } },
        outboundEvents: {
          where: {
            status: 'DISPATCHED',
            ...(hasDateFilter ? { outboundDate: outboundDateFilter } : {}),
          },
          select: { quantityWithdrawnBags: true, outboundWeightKg: true },
        },
      },
    }),
  ]);

  const rows = lots
    .map((l) => {
      const withdrawnBags = l.outboundEvents.reduce(
        (s, e) => s + e.quantityWithdrawnBags,
        0,
      );
      if (withdrawnBags === 0) return null;
      const outboundKg = l.outboundEvents.reduce(
        (s, e) => s + Number(e.outboundWeightKg ?? 0),
        0,
      );
      const inboundProrated =
        l.quantityBags > 0
          ? Number(l.acceptedWeightKg) * (withdrawnBags / l.quantityBags)
          : 0;
      const varianceKg = outboundKg - inboundProrated;
      const variancePct =
        inboundProrated > 0 ? (varianceKg / inboundProrated) * 100 : 0;
      return {
        lot_id: l.id,
        lot_number: l.lotNumber,
        owner_name: l.ownerParty.name,
        inbound_kg_prorated: round2(inboundProrated),
        outbound_kg_total: round2(outboundKg),
        variance_kg: round2(varianceKg),
        variance_pct: round2(variancePct),
        finalized_outbound_count: l.outboundEvents.length,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    data: rows,
    meta: { page: filters.page, per_page: filters.per_page, total },
  };
}
