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

  async getOccupancyByChamberIds(chamberIds: string[]): Promise<Map<string, number>> {
    if (chamberIds.length === 0) return new Map();
    const rows = await this.prisma.lot.groupBy({
      by: ['chamberId'],
      where: { chamberId: { in: chamberIds }, status: 'ACTIVE' },
      _sum: { currentBalanceBags: true },
    });
    const map = new Map<string, number>();
    for (const id of chamberIds) map.set(id, 0);
    for (const row of rows) {
      if (row.chamberId) map.set(row.chamberId, Number(row._sum.currentBalanceBags ?? 0));
    }
    return map;
  }

  async logTemperature(data: Prisma.TemperatureLogUncheckedCreateInput) {
    return this.prisma.temperatureLog.create({
      data,
      include: { recordedByUser: { select: { name: true } } },
    });
  }

  async getFacilityName(facilityId: string): Promise<string | null> {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true },
    });
    return facility?.name ?? null;
  }

  // ── Racks ─────────────────────────────────────────────────────

  async findRacksByChamber(chamberId: string) {
    return this.prisma.rack.findMany({
      where: { chamberId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  async findRackById(facilityId: string, id: string) {
    return this.prisma.rack.findFirst({
      where: { id, facilityId },
      include: { chamber: { select: { id: true, name: true } } },
    });
  }

  async createRack(data: Prisma.RackUncheckedCreateInput) {
    return this.prisma.rack.create({ data });
  }

  async updateRack(id: string, data: Prisma.RackUncheckedUpdateInput) {
    return this.prisma.rack.update({ where: { id }, data });
  }

  async countRacksByChamberIds(chamberIds: string[]): Promise<Map<string, number>> {
    if (chamberIds.length === 0) return new Map();
    const rows = await this.prisma.rack.groupBy({
      by: ['chamberId'],
      where: { chamberId: { in: chamberIds } },
      _count: true,
    });
    const map = new Map<string, number>();
    for (const id of chamberIds) map.set(id, 0);
    for (const row of rows) map.set(row.chamberId, row._count);
    return map;
  }

  /** Bags placed per rack, counting only ACTIVE lots. */
  async getRackOccupancy(rackIds: string[]): Promise<Map<string, number>> {
    if (rackIds.length === 0) return new Map();
    const rows = await this.prisma.lotRackPlacement.groupBy({
      by: ['rackId'],
      where: { rackId: { in: rackIds }, lot: { status: 'ACTIVE' } },
      _sum: { bags: true },
    });
    const map = new Map<string, number>();
    for (const id of rackIds) map.set(id, 0);
    for (const row of rows) map.set(row.rackId, Number(row._sum.bags ?? 0));
    return map;
  }

  /** Total bags placed on any rack of the chamber (ACTIVE lots only). */
  async getPlacedTotalByChamber(chamberId: string): Promise<number> {
    const agg = await this.prisma.lotRackPlacement.aggregate({
      where: { rack: { chamberId }, lot: { status: 'ACTIVE' } },
      _sum: { bags: true },
    });
    return Number(agg._sum.bags ?? 0);
  }

  async countActivePlacements(rackId: string): Promise<number> {
    return this.prisma.lotRackPlacement.count({
      where: { rackId, lot: { status: 'ACTIVE' } },
    });
  }

  async getRackLots(rackId: string) {
    return this.prisma.lotRackPlacement.findMany({
      where: { rackId, lot: { status: 'ACTIVE' } },
      include: {
        lot: {
          select: {
            id: true,
            lotNumber: true,
            marka: true,
            ownerParty: { select: { name: true } },
            commodity: { select: { name: true } },
          },
        },
      },
      orderBy: { bags: 'desc' },
    });
  }
}
