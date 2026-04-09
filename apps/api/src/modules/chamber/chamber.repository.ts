import type { PrismaClient, Prisma } from '@coldchain/db';

export class ChamberRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findMany(facilityId: string, isActive?: boolean) {
    const where: Prisma.ChamberWhereInput = { facilityId };
    if (isActive !== undefined) where.isActive = isActive;

    return this.prisma.chamber.findMany({
      where,
      include: {
        commodityRestriction: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findById(facilityId: string, id: string) {
    return this.prisma.chamber.findFirst({
      where: { id, facilityId },
      include: {
        commodityRestriction: { select: { id: true, name: true } },
      },
    });
  }

  async create(data: Prisma.ChamberUncheckedCreateInput) {
    return this.prisma.chamber.create({
      data,
      include: {
        commodityRestriction: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, data: Prisma.ChamberUncheckedUpdateInput) {
    return this.prisma.chamber.update({
      where: { id },
      data,
      include: {
        commodityRestriction: { select: { id: true, name: true } },
      },
    });
  }

  async getTemperatureLogs(chamberId: string, limit: number = 20) {
    return this.prisma.temperatureLog.findMany({
      where: { chamberId },
      include: { recordedByUser: { select: { name: true } } },
      orderBy: { recordedAt: 'desc' },
      take: limit,
    });
  }

  async getLastTemperature(chamberId: string) {
    return this.prisma.temperatureLog.findFirst({
      where: { chamberId },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async logTemperature(data: Prisma.TemperatureLogUncheckedCreateInput) {
    return this.prisma.temperatureLog.create({
      data,
      include: { recordedByUser: { select: { name: true } } },
    });
  }
}
