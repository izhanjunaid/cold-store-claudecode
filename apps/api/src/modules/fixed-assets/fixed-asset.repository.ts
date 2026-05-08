import type { PrismaClient, Prisma } from '@coldchain/db';

type Tx = Prisma.TransactionClient | PrismaClient;

export class FixedAssetRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(facilityId: string, id: string, db: Tx = this.prisma): Promise<any> {
    return db.fixedAsset.findFirst({
      where: { facilityId, id },
      include: {
        createdByUser: { select: { name: true } },
        schedules: { orderBy: [{ periodYear: 'asc' }, { periodMonth: 'asc' }] },
      },
    });
  }

  async list(
    facilityId: string,
    query: { status?: string; category?: string; page: number; pageSize: number },
  ): Promise<[any[], number]> {
    const where: Prisma.FixedAssetWhereInput = { facilityId };
    if (query.status) where.status = query.status as any;
    if (query.category) where.assetCategory = query.category as any;

    return Promise.all([
      this.prisma.fixedAsset.findMany({
        where,
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { createdByUser: { select: { name: true } } },
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);
  }

  async listInService(facilityId: string, db: Tx = this.prisma): Promise<any[]> {
    return db.fixedAsset.findMany({
      where: { facilityId, status: 'IN_SERVICE' },
      orderBy: { assetNumber: 'asc' },
    });
  }
}
