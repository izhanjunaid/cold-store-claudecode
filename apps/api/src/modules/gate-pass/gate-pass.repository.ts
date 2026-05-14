import type { PrismaClient, Prisma } from '@coldchain/db';

const gatePassInclude = {
  relatedLot: { select: { id: true, lotNumber: true } },
  relatedOutbound: {
    select: {
      id: true,
      dispatchNoteNumber: true,
      invoice: { select: { id: true, totalPkr: true, amountPaidPkr: true, status: true } },
    },
  },
} satisfies Prisma.GatePassInclude;

const gatePassListInclude = {
  relatedLot: { select: { lotNumber: true } },
  relatedOutbound: { select: { dispatchNoteNumber: true } },
} satisfies Prisma.GatePassInclude;

export type GatePassWithRelations = Prisma.GatePassGetPayload<{ include: typeof gatePassInclude }>;
export type GatePassListItem = Prisma.GatePassGetPayload<{ include: typeof gatePassListInclude }>;

export class GatePassRepository {
  constructor(private prisma: PrismaClient) {}

  findById(facilityId: string, id: string): Promise<GatePassWithRelations | null> {
    return this.prisma.gatePass.findFirst({
      where: { facilityId, id },
      include: gatePassInclude,
    });
  }

  list(
    facilityId: string,
    where: Prisma.GatePassWhereInput,
    page: number,
    pageSize: number,
  ): Promise<[GatePassListItem[], number]> {
    return Promise.all([
      this.prisma.gatePass.findMany({
        where: { ...where, facilityId },
        include: gatePassListInclude,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.gatePass.count({ where: { ...where, facilityId } }),
    ]);
  }
}
