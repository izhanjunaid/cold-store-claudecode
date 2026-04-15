import type { PrismaClient } from '@coldchain/db';

const LOT_INCLUDE = {
  chamber: { select: { id: true, name: true } },
  ownerParty: { select: { id: true, name: true, nameUrdu: true } },
  billingParty: { select: { id: true, name: true } },
  commodity: { select: { id: true, name: true } },
  variety: { select: { id: true, name: true } },
  ratePlan: {
    select: { id: true, name: true, rateType: true, rateAmountPkr: true },
  },
  createdByUser: { select: { id: true, name: true } },
};

export class OwnershipTransferRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findTransferById(lotId: string, transferId: string): Promise<unknown> {
    return this.prisma.ownershipHistory.findFirst({
      where: { id: transferId, lotId },
      include: {
        fromParty: { select: { id: true, name: true, nameUrdu: true } },
        toParty: { select: { id: true, name: true, nameUrdu: true } },
        operator: { select: { id: true, name: true } },
        lot: { include: LOT_INCLUDE },
      },
    });
  }
}

export const LOT_INCLUDE_SHAPE_TRANSFER = LOT_INCLUDE;
