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

  /** Unpaid balance across FINALIZED invoices billed to this party — the AR exposure a credit limit is checked against. */
  async getOutstandingPkr(facilityId: string, partyId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ outstanding: string | null }[]>`
      SELECT COALESCE(SUM(total_pkr - amount_paid_pkr), 0)::text AS outstanding
      FROM invoices
      WHERE facility_id = ${facilityId}::uuid
        AND billing_party_id = ${partyId}::uuid
        AND status = 'FINALIZED'
        AND total_pkr > amount_paid_pkr
    `;
    return Number(rows[0]?.outstanding ?? 0);
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
