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
    // Free-text search spans lot number, marka, owner party name, and vehicle number —
    // the fields a munshi actually has in hand ("where is Haji Sahib's stock?").
    if (filters.search) {
      const contains = { contains: filters.search, mode: 'insensitive' as const };
      // Owners are matched first and passed as ids. With the name test inside the
      // lot query (a join), PostgreSQL cannot use the trigram indexes of 0048 and
      // reads every lot; with ids it combines the four indexes.
      // ponytail: a search matching more than 5,000 parties falls back to the join.
      const owners = await this.prisma.party.findMany({
        where: { facilityId: filters.facilityId, name: contains },
        select: { id: true },
        take: 5001,
      });
      where.OR = [
        { lotNumber: contains },
        { marka: contains },
        { vehicleNumber: contains },
        ...(owners.length > 5000
          ? [{ ownerParty: { name: contains } }]
          : owners.length > 0
            ? [{ ownerPartyId: { in: owners.map((o) => o.id) } }]
            : []),
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

  update(id: string, data: Prisma.LotUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.lot.update({
      where: { id },
      data,
      include: LOT_INCLUDE,
    });
  }
}

export const LOT_INCLUDE_SHAPE = LOT_INCLUDE;
