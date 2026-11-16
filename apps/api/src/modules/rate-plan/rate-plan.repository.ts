import type { PrismaClient, Prisma } from "@coldchain/db";

export class RatePlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(facilityId: string, filters: { isActive?: boolean; commodityId?: string }): Promise<unknown[]> {
    const where: Prisma.RatePlanWhereInput = { facilityId };
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.commodityId) where.commodityId = filters.commodityId;
    return this.prisma.ratePlan.findMany({
      where,
      include: { commodity: { select: { id: true, name: true } }, party: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(facilityId: string, id: string): Promise<unknown> {
    return this.prisma.ratePlan.findFirst({
      where: { id, facilityId },
      include: { commodity: { select: { id: true, name: true } }, party: { select: { id: true, name: true } } },
    });
  }

  create(data: Prisma.RatePlanUncheckedCreateInput): Promise<unknown> {
    return this.prisma.ratePlan.create({
      data,
      include: { commodity: { select: { id: true, name: true } }, party: { select: { id: true, name: true } } },
    });
  }

  update(id: string, data: Prisma.RatePlanUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.ratePlan.update({
      where: { id },
      data,
      include: { commodity: { select: { id: true, name: true } }, party: { select: { id: true, name: true } } },
    });
  }

  /** The plan copied with a new price, and the old one closed to new arrivals, together. */
  replaceWithNewRate(old: { id: string }, data: Prisma.RatePlanUncheckedCreateInput): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await tx.ratePlan.update({ where: { id: old.id }, data: { isActive: false } });
      return tx.ratePlan.create({
        data,
        include: { commodity: { select: { id: true, name: true } }, party: { select: { id: true, name: true } } },
      });
    });
  }

  async isInUse(facilityId: string, id: string): Promise<boolean> {
    return (await this.prisma.lot.findFirst({ where: { facilityId, ratePlanId: id }, select: { id: true } })) !== null;
  }

  deactivate(id: string): Promise<unknown> {
    return this.prisma.ratePlan.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
