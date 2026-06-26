import type { PrismaClient, Prisma } from '@coldchain/db';

export class CommodityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(includeVarieties: boolean = true) {
    return this.prisma.commodity.findMany({
      include: includeVarieties ? { varieties: true } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    return this.prisma.commodity.findUnique({
      where: { id },
      include: { varieties: true },
    });
  }

  async create(data: Prisma.CommodityCreateInput) {
    return this.prisma.commodity.create({
      data,
      include: { varieties: true },
    });
  }

  async update(id: string, data: Prisma.CommodityUpdateInput) {
    return this.prisma.commodity.update({
      where: { id },
      data,
      include: { varieties: true },
    });
  }

  async findVarietiesByCommodity(commodityId: string) {
    return this.prisma.variety.findMany({
      where: { commodityId },
      orderBy: { name: 'asc' },
    });
  }

  async findAllVarieties() {
    return this.prisma.variety.findMany({ orderBy: { name: 'asc' } });
  }

  async createVariety(data: Prisma.VarietyUncheckedCreateInput) {
    return this.prisma.variety.create({ data });
  }
}
