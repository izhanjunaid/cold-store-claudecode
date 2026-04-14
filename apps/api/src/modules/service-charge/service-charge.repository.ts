import type { PrismaClient, Prisma } from "@coldchain/db";

export class ServiceChargeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findMany(facilityId: string, isActive?: boolean): Promise<unknown[]> {
    const where: Prisma.ServiceChargeWhereInput = { facilityId };
    if (isActive !== undefined) where.isActive = isActive;
    return this.prisma.serviceCharge.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  findById(facilityId: string, id: string): Promise<unknown> {
    return this.prisma.serviceCharge.findFirst({
      where: { id, facilityId },
    });
  }

  findByName(facilityId: string, name: string): Promise<unknown> {
    return this.prisma.serviceCharge.findFirst({
      where: { facilityId, name },
    });
  }

  create(data: Prisma.ServiceChargeUncheckedCreateInput): Promise<unknown> {
    return this.prisma.serviceCharge.create({ data });
  }

  update(id: string, data: Prisma.ServiceChargeUncheckedUpdateInput): Promise<unknown> {
    return this.prisma.serviceCharge.update({ where: { id }, data });
  }

  deactivate(id: string): Promise<unknown> {
    return this.prisma.serviceCharge.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
