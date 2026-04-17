import type { PrismaClient, Prisma } from '@coldchain/db';

const outboundInclude = {
  lot: { select: { lotNumber: true, quantityBags: true, acceptedWeightKg: true } },
  receivingParty: { select: { name: true } },
  createdByUser: { select: { name: true } },
} satisfies Prisma.OutboundEventInclude;

export type OutboundWithRelations = Prisma.OutboundEventGetPayload<{
  include: typeof outboundInclude;
}>;

export class OutboundRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(facilityId: string, id: string): Promise<OutboundWithRelations | null> {
    return this.prisma.outboundEvent.findFirst({
      where: { id, facilityId },
      include: outboundInclude,
    });
  }

  async findByLot(facilityId: string, lotId: string): Promise<OutboundWithRelations[]> {
    return this.prisma.outboundEvent.findMany({
      where: { facilityId, lotId },
      include: outboundInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(
    tx: Prisma.TransactionClient,
    data: Prisma.OutboundEventUncheckedCreateInput,
  ): Promise<OutboundWithRelations> {
    return tx.outboundEvent.create({
      data,
      include: outboundInclude,
    });
  }

  async update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Prisma.OutboundEventUncheckedUpdateInput,
  ): Promise<OutboundWithRelations> {
    return tx.outboundEvent.update({
      where: { id },
      data,
      include: outboundInclude,
    });
  }
}
