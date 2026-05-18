import type { PrismaClient, Prisma } from '@coldchain/db';
import { round2 } from '../helpers/money';

export interface CommodityInventoryFilters {
  commodity_id?: string;
  chamber_id?: string;
}

export async function getCommodityInventory(
  prisma: PrismaClient,
  facilityId: string,
  filters: CommodityInventoryFilters,
) {
  const where: Prisma.LotWhereInput = { facilityId, status: 'ACTIVE' };
  if (filters.commodity_id) where.commodityId = filters.commodity_id;
  if (filters.chamber_id) where.chamberId = filters.chamber_id;

  const grouped = await prisma.lot.groupBy({
    by: ['commodityId', 'chamberId'],
    where,
    _sum: { currentBalanceBags: true },
  });

  if (grouped.length === 0) return [];

  const commodityIds = Array.from(new Set(grouped.map((g) => g.commodityId)));
  const chamberIds = Array.from(new Set(grouped.map((g) => g.chamberId)));

  const [commodities, chambers] = await Promise.all([
    prisma.commodity.findMany({
      where: { id: { in: commodityIds } },
      select: { id: true, name: true },
    }),
    prisma.chamber.findMany({
      where: { id: { in: chamberIds } },
      select: { id: true, name: true, maxCapacityBags: true },
    }),
  ]);

  const commodityById = new Map(commodities.map((c) => [c.id, c]));
  const chamberById = new Map(chambers.map((c) => [c.id, c]));

  type Row = {
    commodity_id: string;
    commodity_name: string;
    total_bags: number;
    per_chamber: Array<{
      chamber_id: string;
      chamber_name: string;
      bags: number;
      occupancy_pct: number;
    }>;
  };

  const byCommodity = new Map<string, Row>();
  for (const g of grouped) {
    const bags = g._sum.currentBalanceBags ?? 0;
    if (bags === 0) continue;
    const commodity = commodityById.get(g.commodityId);
    const chamber = chamberById.get(g.chamberId);
    if (!commodity || !chamber) continue;

    let row = byCommodity.get(g.commodityId);
    if (!row) {
      row = {
        commodity_id: commodity.id,
        commodity_name: commodity.name,
        total_bags: 0,
        per_chamber: [],
      };
      byCommodity.set(g.commodityId, row);
    }
    row.total_bags += bags;
    const occupancy_pct =
      chamber.maxCapacityBags > 0 ? round2((bags / chamber.maxCapacityBags) * 100) : 0;
    row.per_chamber.push({
      chamber_id: chamber.id,
      chamber_name: chamber.name,
      bags,
      occupancy_pct,
    });
  }

  const rows = Array.from(byCommodity.values()).sort((a, b) =>
    a.commodity_name.localeCompare(b.commodity_name),
  );
  for (const r of rows) {
    r.per_chamber.sort((a, b) => a.chamber_name.localeCompare(b.chamber_name));
  }
  return rows;
}
