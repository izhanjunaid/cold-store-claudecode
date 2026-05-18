import type { PrismaClient, Prisma } from '@coldchain/db';
import { daysInStorage } from '../helpers/days-in-storage';
import { parseDateOnly, startOfToday } from '../helpers/money';

const DEFAULT_STORAGE_ALERT_DAYS = 90;

export interface LotAgingFilters {
  date_from?: string;
  date_to?: string;
  party_id?: string;
  chamber_id?: string;
  commodity_id?: string;
  page: number;
  per_page: number;
}

export async function getLotAging(
  prisma: PrismaClient,
  facilityId: string,
  filters: LotAgingFilters,
) {
  const where: Prisma.LotWhereInput = { facilityId, status: 'ACTIVE' };
  if (filters.party_id) where.ownerPartyId = filters.party_id;
  if (filters.chamber_id) where.chamberId = filters.chamber_id;
  if (filters.commodity_id) where.commodityId = filters.commodity_id;
  const fromDate = parseDateOnly(filters.date_from);
  const toDate = parseDateOnly(filters.date_to);
  if (fromDate || toDate) {
    where.inboundDate = {};
    if (fromDate) (where.inboundDate as Prisma.DateTimeFilter).gte = fromDate;
    if (toDate) (where.inboundDate as Prisma.DateTimeFilter).lte = toDate;
  }

  const today = startOfToday();
  const skip = (filters.page - 1) * filters.per_page;

  const [total, lots] = await Promise.all([
    prisma.lot.count({ where }),
    prisma.lot.findMany({
      where,
      orderBy: [{ inboundDate: 'asc' }],
      skip,
      take: filters.per_page,
      select: {
        id: true,
        lotNumber: true,
        inboundDate: true,
        currentBalanceBags: true,
        commodity: { select: { name: true, defaultStorageDaysAlert: true } },
        chamber: { select: { name: true } },
        ownerParty: { select: { name: true } },
      },
    }),
  ]);

  const rows = lots.map((l) => {
    const threshold = l.commodity.defaultStorageDaysAlert ?? DEFAULT_STORAGE_ALERT_DAYS;
    const days = daysInStorage(l.inboundDate, today);
    return {
      lot_id: l.id,
      lot_number: l.lotNumber,
      owner_name: l.ownerParty.name,
      commodity_name: l.commodity.name,
      chamber_name: l.chamber.name,
      current_bags: l.currentBalanceBags,
      inbound_date: l.inboundDate.toISOString().slice(0, 10),
      days_in_storage: days,
      threshold,
      threshold_exceeded: days > threshold,
    };
  });

  return {
    data: rows,
    meta: { page: filters.page, per_page: filters.per_page, total },
  };
}
