import type { PrismaClient, Prisma, PaymentMethod, PaymentStatus } from '@coldchain/db';

const paymentInclude = {
  party: { select: { name: true } },
  createdByUser: { select: { name: true } },
  allocations: {
    include: {
      invoice: { select: { invoiceNumber: true } },
    },
  },
} satisfies Prisma.PaymentInclude;

export type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export class PaymentRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(facilityId: string, id: string): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findFirst({
      where: { id, facilityId },
      include: paymentInclude,
    });
  }

  async list(
    facilityId: string,
    filters: {
      partyId?: string;
      status?: PaymentStatus;
      paymentMethod?: PaymentMethod;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination: { page: number; pageSize: number },
  ): Promise<{ data: PaymentWithRelations[]; total: number }> {
    const where: Prisma.PaymentWhereInput = {
      facilityId,
      ...(filters.partyId ? { partyId: filters.partyId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            paymentDate: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: paymentInclude,
        orderBy: { paymentDate: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { data, total };
  }

  async create(
    tx: Prisma.TransactionClient,
    data: Prisma.PaymentUncheckedCreateInput,
  ): Promise<PaymentWithRelations> {
    return tx.payment.create({ data, include: paymentInclude });
  }

  async update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.PaymentUncheckedUpdateInput,
  ): Promise<PaymentWithRelations> {
    return tx.payment.update({ where: { id }, data, include: paymentInclude });
  }
}
