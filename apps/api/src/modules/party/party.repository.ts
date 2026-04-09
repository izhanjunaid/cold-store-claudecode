import type { PrismaClient, Prisma } from '@coldchain/db';

export interface PartyFilters {
  facilityId: string;
  type?: string;
  isActive?: boolean;
  search?: string;
  page: number;
  perPage: number;
}

export class PartyRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMany(filters: PartyFilters) {
    const where: Prisma.PartyWhereInput = {
      facilityId: filters.facilityId,
    };

    if (filters.type) where.partyType = filters.type as Prisma.EnumPartyTypeFilter['equals'];
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { phonePrimary: { contains: filters.search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.party.findMany({
        where,
        include: { parentArhti: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.perPage,
        take: filters.perPage,
      }),
      this.prisma.party.count({ where }),
    ]);

    return { data, total };
  }

  async findById(facilityId: string, id: string) {
    return this.prisma.party.findFirst({
      where: { id, facilityId },
      include: { parentArhti: { select: { name: true } } },
    });
  }

  async findByPhone(facilityId: string, phone: string) {
    return this.prisma.party.findFirst({
      where: { facilityId, phonePrimary: phone },
    });
  }

  async create(data: Prisma.PartyUncheckedCreateInput) {
    return this.prisma.party.create({
      data,
      include: { parentArhti: { select: { name: true } } },
    });
  }

  async update(id: string, data: Prisma.PartyUncheckedUpdateInput) {
    return this.prisma.party.update({
      where: { id },
      data,
      include: { parentArhti: { select: { name: true } } },
    });
  }

  async deactivate(id: string) {
    return this.prisma.party.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
