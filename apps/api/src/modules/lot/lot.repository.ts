import type { PrismaClient, Prisma } from '@coldchain/db';

export interface LotListFilters {
  facilityId: string;
  status?: 'ACTIVE' | 'CLOSED' | 'SUSPENDED';
  partyId?: string;
  commodityId?: string;
  chamberId?: string;
  inboundDateFrom?: string;
  inboundDateTo?: string;
  marka?: string;
  search?: string;
  page: number;
  perPage: number;
}

const LOT_INCLUDE = {
  chamber: { select: { id: true, name: true } },
  ownerParty: { select: { id: true, name: true, nameUrdu: true } },
  billingParty: { select: { id: true, name: true } },
  commodity: { select: { id: true, name: true } },
  variety: { select: { id: true, name: true } },
  ratePlan: {
    select: { id: true, name: true, rateType: true, rateAmountPkr: true },
  },
  createdByUser: { select: { id: true, name: true } },
};

export class LotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMany(filters: LotListFilters): Promise<{ data: unknown[]; total: number }> {
    const where: Prisma.LotWhereInput = { facilityId: filters.facilityId };
    if (filters.status) where.status = filters.status;
    if (filters.partyId) where.ownerPartyId = filters.partyId;
    if (filters.commodityId) where.commodityId = filters.commodityId;
    if (filters.chamberId) where.chamberId = filters.chamberId;
    if (filters.inboundDateFrom || filters.inboundDateTo) {
      where.inboundDate = {};
      if (filters.inboundDateFrom) where.inboundDate.gte = new Date(filters.inboundDateFrom);
      if (filters.inboundDateTo) where.inboundDate.lte = new Date(filters.inboundDateTo);
    }
    // Dedicated marka filter — prefix match (case-insensitive) so the
    // (facility_id, marka) index can be used for "find stack by marka".
    if (filters.marka) {
      where.marka = { startsWith: filters.marka, mode: 'insensitive' };
    }
    // Free-text search spans lot number and marka.
    if (filters.search) {
      where.OR = [
        { lotNumber: { contains: filters.search, mode: 'insensitive' } },
        { marka: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.lot.findMany({
        where,
        include: LOT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.perPage,
        take: filters.perPage,
      }),
      this.prisma.lot.count({ where }),
    ]);

    return { data, total };
  }

  findById(facilityId: string, id: string): Promise<unknown> {
    return this.prisma.lot.findFirst({
      where: { id, facilityId },
      include: LOT_INCLUDE,
    });
  }

  findOwnershipHistory(lotId: string): Promise<unknown[]> {
    return this.prisma.ownershipHistory.findMany({
      where: { lotId },
      orderBy: { effectiveDate: 'asc' },
      include: {
        fromParty: { select: { id: true, name: true } },
        toParty: { select: { id: true, name: true } },
        operator: { select: { id: true, name: true } },
      },
    });
  }

  sumActiveBalanceByChamber(facilityId: string, chamberId: string) {
    return this.prisma.lot.aggregate({
      where: { facilityId, chamberId, status: 'ACTIVE' },
      _sum: { currentBalanceBags: true },
    });
  }

  update(id: string, data: Prisma.LotUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.lot.update({
      where: { id },
      data,
      include: LOT_INCLUDE,
    });
  }
}

export const LOT_INCLUDE_SHAPE = LOT_INCLUDE;
