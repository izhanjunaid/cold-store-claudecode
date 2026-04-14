import type { PrismaClient, Prisma } from "@coldchain/db";

export class RatePlanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(facilityId: string, filters: { isActive?: boolean; commodityId?: string }): Promise<unknown[]> {
    const where: Prisma.RatePlanWhereInput = { facilityId };
    if (filters.isActive !== undefined) where.isActive = filters.isActive;
    if (filters.commodityId) where.commodityId = filters.commodityId;
    return this.prisma.ratePlan.findMany({
      where,
      include: { commodity: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(facilityId: string, id: string): Promise<unknown> {
    return this.prisma.ratePlan.findFirst({
      where: { id, facilityId },
      include: { commodity: { select: { id: true, name: true } } },
    });
  }

  create(data: Prisma.RatePlanUncheckedCreateInput): Promise<unknown> {
    return this.prisma.ratePlan.create({
      data,
      include: { commodity: { select: { id: true, name: true } } },
    });
  }

  update(id: string, data: Prisma.RatePlanUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.ratePlan.update({
      where: { id },
      data,
      include: { commodity: { select: { id: true, name: true } } },
    });
  }

  deactivate(id: string): Promise<unknown> {
    return this.prisma.ratePlan.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
