import type { PrismaClient, Prisma } from '@coldchain/db';

// Room + rack placements of the linked lot, so security can verify the
// physical marka against where the system says the stock sits.
const lotLocationSelect = {
  chamber: { select: { name: true } },
  rackPlacements: {
    select: { bags: true, rack: { select: { name: true } } },
  },
} as const;

const gatePassInclude = {
  relatedLot: {
    select: {
      id: true,
      lotNumber: true,
      marka: true,
      commodity: { select: { name: true, unitLabel: true } },
      ...lotLocationSelect,
    },
  },
  relatedOutbound: {
    select: {
      id: true,
      dispatchNoteNumber: true,
      quantityWithdrawnBags: true,
      invoice: { select: { id: true, totalPkr: true, amountPaidPkr: true, status: true } },
      lot: {
        select: {
          marka: true,
          commodity: { select: { name: true, unitLabel: true } },
          ...lotLocationSelect,
        },
      },
      ownerPartySnapshot: { select: { name: true } },
    },
  },
  party: { select: { id: true, name: true } },
} satisfies Prisma.GatePassInclude;

const gatePassListInclude = {
  relatedLot: { select: { lotNumber: true, ...lotLocationSelect } },
  relatedOutbound: {
    select: {
      dispatchNoteNumber: true,
      quantityWithdrawnBags: true,
      lot: { select: lotLocationSelect },
    },
  },
  party: { select: { id: true, name: true } },
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
