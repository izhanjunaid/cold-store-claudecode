import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { renderPlacementSlip } from '../pdf/pdf.service';

type Tx = Prisma.TransactionClient;

export interface PlacementInput {
  rackId: string;
  bags: number;
}

/**
 * Plan which placements to trim (largest-first) so that `excess` bags are
 * removed. Pure — returns the per-rack trim amounts without touching the DB.
 */
export function planTrim(
  placements: { rackId: string; bags: number }[],
  excess: number,
): { rackId: string; bags: number }[] {
  const trims: { rackId: string; bags: number }[] = [];
  const sorted = [...placements].sort((a, b) => b.bags - a.bags);
  let remaining = excess;
  for (const p of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, p.bags);
    trims.push({ rackId: p.rackId, bags: take });
    remaining -= take;
  }
  return trims;
}

function assertNoDuplicateRacks(placements: PlacementInput[]) {
  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.rackId)) {
      throw Errors.VALIDATION_ERROR('Duplicate rack in placements', 'placements');
    }
    seen.add(p.rackId);
  }
}

/**
 * Load and validate the racks referenced by `placements`: they must exist,
 * belong to the given facility AND chamber, and be active.
 */
async function loadRacksForPlacements(
  tx: Tx,
  facilityId: string,
  chamberId: string,
  placements: PlacementInput[],
) {
  assertNoDuplicateRacks(placements);
  const racks = await tx.rack.findMany({
    where: { id: { in: placements.map((p) => p.rackId) }, facilityId },
  });
  const byId = new Map(racks.map((r) => [r.id, r]));
  for (const p of placements) {
    const rack = byId.get(p.rackId);
    if (!rack) throw Errors.VALIDATION_ERROR('Rack not found', 'placements');
    if (rack.chamberId !== chamberId) {
      throw Errors.VALIDATION_ERROR(
        `Rack ${rack.name} belongs to a different room`,
        'placements',
      );
    }
    if (!rack.isActive) {
      throw Errors.VALIDATION_ERROR(`Rack ${rack.name} is inactive`, 'placements');
    }
  }
  return byId;
}

/**
 * Soft-capacity check: warn (never block) when a rack would exceed its
 * capacity. Occupancy counts placements of ACTIVE lots, excluding
 * `excludeLotId` (whose placements are being replaced by this operation).
 */
async function rackOverflowWarnings(
  tx: Tx,
  racks: Map<string, { id: string; name: string; maxCapacityBags: number }>,
  placements: PlacementInput[],
  excludeLotId?: string,
): Promise<string[]> {
  const rackIds = placements.map((p) => p.rackId);
  const rows = await tx.lotRackPlacement.groupBy({
    by: ['rackId'],
    where: {
      rackId: { in: rackIds },
      lot: { status: 'ACTIVE' },
      ...(excludeLotId ? { lotId: { not: excludeLotId } } : {}),
    },
    _sum: { bags: true },
  });
  const occupancy = new Map(rows.map((r) => [r.rackId, Number(r._sum.bags ?? 0)]));
  const warnings: string[] = [];
  for (const p of placements) {
    const rack = racks.get(p.rackId)!;
    const occupied = occupancy.get(p.rackId) ?? 0;
    if (occupied + p.bags > rack.maxCapacityBags) {
      warnings.push(
        `Rack ${rack.name} will exceed its capacity (${rack.maxCapacityBags} bags) after this placement`,
      );
    }
  }
  return warnings;
}

/**
 * Full-replace a lot's rack allocation inside an existing transaction.
 * Validates racks and the balance invariant, logs PLACEMENT movements for
 * the per-rack deltas, and returns soft-capacity warnings.
 */
export async function applyPlacements(
  tx: Tx,
  params: {
    facilityId: string;
    lotId: string;
    chamberId: string;
    currentBalanceBags: number;
    placements: PlacementInput[];
    movedBy: string;
  },
): Promise<string[]> {
  const { facilityId, lotId, chamberId, placements, movedBy } = params;

  const total = placements.reduce((sum, p) => sum + p.bags, 0);
  if (total > params.currentBalanceBags) {
    throw Errors.VALIDATION_ERROR(
      `Placements total (${total}) exceeds lot balance (${params.currentBalanceBags})`,
      'placements',
    );
  }

  const racks = await loadRacksForPlacements(tx, facilityId, chamberId, placements);
  const warnings = await rackOverflowWarnings(tx, racks, placements, lotId);

  const existing = await tx.lotRackPlacement.findMany({ where: { lotId } });
  const existingByRack = new Map(existing.map((p) => [p.rackId, p.bags]));

  await tx.lotRackPlacement.deleteMany({ where: { lotId } });
  if (placements.length > 0) {
    await tx.lotRackPlacement.createMany({
      data: placements.map((p) => ({
        facilityId,
        lotId,
        rackId: p.rackId,
        bags: p.bags,
      })),
    });
  }

  // Log the per-rack delta so the timeline reads as physical events.
  const movements: Prisma.LotMovementUncheckedCreateInput[] = [];
  const touched = new Set([...placements.map((p) => p.rackId), ...existingByRack.keys()]);
  for (const rackId of touched) {
    const before = existingByRack.get(rackId) ?? 0;
    const after = placements.find((p) => p.rackId === rackId)?.bags ?? 0;
    if (after > before) {
      movements.push({
        facilityId,
        lotId,
        movementType: 'PLACEMENT',
        toChamberId: chamberId,
        toRackId: rackId,
        bags: after - before,
        movedBy,
      });
    } else if (before > after) {
      movements.push({
        facilityId,
        lotId,
        movementType: 'PLACEMENT',
        fromChamberId: chamberId,
        fromRackId: rackId,
        bags: before - after,
        movedBy,
      });
    }
  }
  if (movements.length > 0) {
    await tx.lotMovement.createMany({ data: movements });
  }

  return warnings;
}

/**
 * Reconcile a lot's placements after its balance dropped to `newBalance`
 * (withdrawal finalize). Explicit `pickedFrom` racks are trimmed first;
 * any remainder auto-trims largest-first. Runs inside the caller's tx.
 */
export async function reconcileWithdrawal(
  tx: Tx,
  params: {
    facilityId: string;
    lotId: string;
    chamberId: string;
    newBalance: number;
    withdrawnBags: number;
    pickedFrom?: PlacementInput[];
    movedBy: string;
  },
): Promise<void> {
  const { facilityId, lotId, chamberId, movedBy } = params;
  const placements = await tx.lotRackPlacement.findMany({
    where: { lotId },
    include: { rack: { select: { name: true } } },
  });
  const byRack = new Map(placements.map((p) => [p.rackId, p]));

  const trims: { rackId: string; bags: number }[] = [];

  if (params.pickedFrom && params.pickedFrom.length > 0) {
    assertNoDuplicateRacks(params.pickedFrom);
    const pickedTotal = params.pickedFrom.reduce((s, p) => s + p.bags, 0);
    if (pickedTotal > params.withdrawnBags) {
      throw Errors.VALIDATION_ERROR(
        `picked_from total (${pickedTotal}) exceeds withdrawn quantity (${params.withdrawnBags})`,
        'picked_from',
      );
    }
    for (const pick of params.pickedFrom) {
      const placement = byRack.get(pick.rackId);
      if (!placement || placement.bags < pick.bags) {
        throw Errors.VALIDATION_ERROR(
          `picked_from exceeds the bags placed on rack ${placement?.rack.name ?? pick.rackId}`,
          'picked_from',
        );
      }
      trims.push({ rackId: pick.rackId, bags: pick.bags });
    }
  }

  // Auto-trim any remaining excess, largest placements first.
  const afterPicks = placements
    .map((p) => ({
      rackId: p.rackId,
      bags: p.bags - (trims.find((t) => t.rackId === p.rackId)?.bags ?? 0),
    }))
    .filter((p) => p.bags > 0);
  const placedAfterPicks = afterPicks.reduce((s, p) => s + p.bags, 0);
  const excess = placedAfterPicks - params.newBalance;
  if (excess > 0) {
    for (const t of planTrim(afterPicks, excess)) {
      const existing = trims.find((x) => x.rackId === t.rackId);
      if (existing) existing.bags += t.bags;
      else trims.push(t);
    }
  }

  for (const trim of trims) {
    const placement = byRack.get(trim.rackId)!;
    if (placement.bags - trim.bags <= 0) {
      await tx.lotRackPlacement.delete({ where: { id: placement.id } });
    } else {
      await tx.lotRackPlacement.update({
        where: { id: placement.id },
        data: { bags: placement.bags - trim.bags },
      });
    }
    await tx.lotMovement.create({
      data: {
        facilityId,
        lotId,
        movementType: 'WITHDRAWAL_PICK',
        fromChamberId: chamberId,
        fromRackId: trim.rackId,
        bags: trim.bags,
        movedBy,
      },
    });
  }
}

/**
 * Partial ownership transfer: the bags never move, so the transferred
 * quantity is re-attributed from the parent's placements (largest-first)
 * onto the child lot on the same racks. No movement rows — nothing moved.
 */
export async function mirrorTransferPlacements(
  tx: Tx,
  params: {
    facilityId: string;
    parentLotId: string;
    childLotId: string;
    parentNewBalanceBags: number;
  },
): Promise<void> {
  const placements = await tx.lotRackPlacement.findMany({
    where: { lotId: params.parentLotId },
  });
  const placedTotal = placements.reduce((s, p) => s + p.bags, 0);
  // Trim only what the parent's reduced balance can no longer cover; if the
  // parent had enough unplaced bags to absorb the transfer, nothing mirrors
  // and the child starts unplaced (physically ambiguous which bags changed
  // hands, so the operator places the child explicitly).
  const trimNeeded = Math.max(0, placedTotal - params.parentNewBalanceBags);
  if (trimNeeded === 0) return;
  const trims = planTrim(
    placements.map((p) => ({ rackId: p.rackId, bags: p.bags })),
    trimNeeded,
  );
  for (const trim of trims) {
    const placement = placements.find((p) => p.rackId === trim.rackId)!;
    if (placement.bags - trim.bags <= 0) {
      await tx.lotRackPlacement.delete({ where: { id: placement.id } });
    } else {
      await tx.lotRackPlacement.update({
        where: { id: placement.id },
        data: { bags: placement.bags - trim.bags },
      });
    }
    await tx.lotRackPlacement.create({
      data: {
        facilityId: params.facilityId,
        lotId: params.childLotId,
        rackId: trim.rackId,
        bags: trim.bags,
      },
    });
  }
}

interface PlacementRow {
  rackId: string;
  bags: number;
  rack: { name: string; position: number };
}

function toPlacementsResponse(
  lot: { id: string; chamberId: string; currentBalanceBags: number; chamber?: { name: string } | null },
  placements: PlacementRow[],
) {
  const sorted = [...placements].sort(
    (a, b) => a.rack.position - b.rack.position || a.rack.name.localeCompare(b.rack.name),
  );
  const placedTotal = placements.reduce((s, p) => s + p.bags, 0);
  return {
    lot_id: lot.id,
    chamber_id: lot.chamberId,
    chamber_name: lot.chamber?.name ?? null,
    current_balance_bags: lot.currentBalanceBags,
    placements: sorted.map((p) => ({
      rack_id: p.rackId,
      rack_name: p.rack.name,
      bags: p.bags,
    })),
    unplaced_bags: Math.max(0, lot.currentBalanceBags - placedTotal),
  };
}

const PLACEMENT_INCLUDE = { rack: { select: { name: true, position: true } } } as const;

export class PlacementService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getLotOrThrow(tx: Tx | PrismaClient, facilityId: string, lotId: string) {
    const lot = await tx.lot.findFirst({
      where: { id: lotId, facilityId },
      include: { chamber: { select: { name: true } } },
    });
    if (!lot) throw Errors.LOT_NOT_FOUND();
    return lot;
  }

  async getPlacements(facilityId: string, lotId: string) {
    const lot = await this.getLotOrThrow(this.prisma, facilityId, lotId);
    const placements = await this.prisma.lotRackPlacement.findMany({
      where: { lotId },
      include: PLACEMENT_INCLUDE,
    });
    return toPlacementsResponse(lot, placements as PlacementRow[]);
  }

  async setPlacements(
    facilityId: string,
    lotId: string,
    userId: string,
    placements: PlacementInput[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT 1 FROM lots WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        lotId,
        facilityId,
      );
      const lot = await this.getLotOrThrow(tx, facilityId, lotId);
      if (lot.status !== 'ACTIVE') throw Errors.LOT_NOT_ACTIVE();

      const warnings = await applyPlacements(tx, {
        facilityId,
        lotId,
        chamberId: lot.chamberId,
        currentBalanceBags: lot.currentBalanceBags,
        placements,
        movedBy: userId,
      });

      const rows = await tx.lotRackPlacement.findMany({
        where: { lotId },
        include: PLACEMENT_INCLUDE,
      });
      return {
        ...toPlacementsResponse(lot, rows as PlacementRow[]),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    });
  }

  async move(
    facilityId: string,
    lotId: string,
    userId: string,
    body:
      | { type: 'RACK'; from_rack_id: string; to_rack_id: string; bags: number; reason?: string }
      | { type: 'ROOM'; to_chamber_id: string; placements?: { rack_id: string; bags: number }[]; reason?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT 1 FROM lots WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        lotId,
        facilityId,
      );
      const lot = await this.getLotOrThrow(tx, facilityId, lotId);
      if (lot.status !== 'ACTIVE') throw Errors.LOT_NOT_ACTIVE();

      const warnings =
        body.type === 'RACK'
          ? await this.moveRack(tx, lot, userId, body)
          : await this.moveRoom(tx, lot, userId, body);

      const updated = await this.getLotOrThrow(tx, facilityId, lotId);
      const rows = await tx.lotRackPlacement.findMany({
        where: { lotId },
        include: PLACEMENT_INCLUDE,
      });
      return {
        ...toPlacementsResponse(updated, rows as PlacementRow[]),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    });
  }

  private async moveRack(
    tx: Tx,
    lot: { id: string; facilityId: string; chamberId: string },
    userId: string,
    body: { from_rack_id: string; to_rack_id: string; bags: number; reason?: string },
  ): Promise<string[]> {
    if (body.from_rack_id === body.to_rack_id) {
      throw Errors.VALIDATION_ERROR('Source and destination racks are the same', 'to_rack_id');
    }

    const from = await tx.lotRackPlacement.findFirst({
      where: { lotId: lot.id, rackId: body.from_rack_id },
      include: { rack: { select: { name: true } } },
    });
    if (!from || from.bags < body.bags) {
      throw Errors.VALIDATION_ERROR(
        `Only ${from?.bags ?? 0} bags of this lot sit on the source rack`,
        'bags',
      );
    }

    const racks = await loadRacksForPlacements(tx, lot.facilityId, lot.chamberId, [
      { rackId: body.to_rack_id, bags: body.bags },
    ]);
    const warnings = await rackOverflowWarnings(
      tx,
      racks,
      [{ rackId: body.to_rack_id, bags: body.bags }],
      lot.id,
    );

    if (from.bags - body.bags <= 0) {
      await tx.lotRackPlacement.delete({ where: { id: from.id } });
    } else {
      await tx.lotRackPlacement.update({
        where: { id: from.id },
        data: { bags: from.bags - body.bags },
      });
    }
    await tx.lotRackPlacement.upsert({
      where: { lotId_rackId: { lotId: lot.id, rackId: body.to_rack_id } },
      update: { bags: { increment: body.bags } },
      create: {
        facilityId: lot.facilityId,
        lotId: lot.id,
        rackId: body.to_rack_id,
        bags: body.bags,
      },
    });

    await tx.lotMovement.create({
      data: {
        facilityId: lot.facilityId,
        lotId: lot.id,
        movementType: 'RACK_TRANSFER',
        fromChamberId: lot.chamberId,
        toChamberId: lot.chamberId,
        fromRackId: body.from_rack_id,
        toRackId: body.to_rack_id,
        bags: body.bags,
        reason: body.reason ?? null,
        movedBy: userId,
      },
    });

    return warnings;
  }

  private async moveRoom(
    tx: Tx,
    lot: {
      id: string;
      facilityId: string;
      chamberId: string;
      commodityId: string;
      currentBalanceBags: number;
    },
    userId: string,
    body: { to_chamber_id: string; placements?: { rack_id: string; bags: number }[]; reason?: string },
  ): Promise<string[]> {
    if (body.to_chamber_id === lot.chamberId) {
      throw Errors.VALIDATION_ERROR('Lot is already in this room', 'to_chamber_id');
    }
    const toChamber = await tx.chamber.findFirst({
      where: { id: body.to_chamber_id, facilityId: lot.facilityId },
    });
    if (!toChamber) throw Errors.VALIDATION_ERROR('Room not found', 'to_chamber_id');
    if (!toChamber.isActive) {
      throw Errors.VALIDATION_ERROR('Room is inactive', 'to_chamber_id');
    }
    if (
      toChamber.commodityRestrictionId &&
      toChamber.commodityRestrictionId !== lot.commodityId
    ) {
      throw Errors.VALIDATION_ERROR(
        'Room is restricted to a different commodity',
        'to_chamber_id',
      );
    }

    // Hard capacity at the destination room — same rule as inbound.
    const agg = await tx.lot.aggregate({
      where: { facilityId: lot.facilityId, chamberId: toChamber.id, status: 'ACTIVE' },
      _sum: { currentBalanceBags: true },
    });
    const occupancy = agg._sum.currentBalanceBags ?? 0;
    if (occupancy + lot.currentBalanceBags > toChamber.maxCapacityBags) {
      throw Errors.CHAMBER_CAPACITY_EXCEEDED();
    }

    await tx.lotRackPlacement.deleteMany({ where: { lotId: lot.id } });
    await tx.lot.update({
      where: { id: lot.id },
      data: { chamberId: toChamber.id },
    });

    await tx.lotMovement.create({
      data: {
        facilityId: lot.facilityId,
        lotId: lot.id,
        movementType: 'ROOM_TRANSFER',
        fromChamberId: lot.chamberId,
        toChamberId: toChamber.id,
        bags: lot.currentBalanceBags,
        reason: body.reason ?? null,
        movedBy: userId,
      },
    });

    let warnings: string[] = [];
    if (body.placements && body.placements.length > 0) {
      warnings = await applyPlacements(tx, {
        facilityId: lot.facilityId,
        lotId: lot.id,
        chamberId: toChamber.id,
        currentBalanceBags: lot.currentBalanceBags,
        placements: body.placements.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
        movedBy: userId,
      });
    }
    return warnings;
  }

  async getPlacementSlipPdf(
    facilityId: string,
    lotId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const lot = await this.prisma.lot.findFirst({
      where: { id: lotId, facilityId },
      include: {
        chamber: { select: { name: true } },
        ownerParty: { select: { name: true } },
        commodity: { select: { name: true } },
        variety: { select: { name: true } },
        createdByUser: { select: { name: true } },
      },
    });
    if (!lot) throw Errors.LOT_NOT_FOUND();

    const placements = await this.prisma.lotRackPlacement.findMany({
      where: { lotId },
      include: PLACEMENT_INCLUDE,
    });
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, city: true },
    });

    const sorted = (placements as PlacementRow[]).sort(
      (a, b) => a.rack.position - b.rack.position || a.rack.name.localeCompare(b.rack.name),
    );
    const placedTotal = sorted.reduce((s, p) => s + p.bags, 0);

    const pdf = await renderPlacementSlip({
      facilityName: facility?.name ?? 'ColdChain',
      facilityCity: facility?.city ?? '',
      lotNumber: lot.lotNumber,
      ownerName: lot.ownerParty?.name ?? '',
      commodityName: lot.commodity?.name ?? '',
      varietyName: lot.variety?.name ?? null,
      marka: lot.marka ?? null,
      roomName: lot.chamber?.name ?? '',
      placements: sorted.map((p) => ({ rackName: p.rack.name, bags: p.bags })),
      unplacedBags: Math.max(0, lot.currentBalanceBags - placedTotal),
      totalBags: lot.currentBalanceBags,
      operatorName: lot.createdByUser?.name ?? '',
      generatedAt: new Date().toISOString().slice(0, 10),
    });

    return { filename: `${lot.lotNumber}-placement.pdf`, pdf };
  }

  async getMovements(facilityId: string, lotId: string) {
    await this.getLotOrThrow(this.prisma, facilityId, lotId);
    const movements = await this.prisma.lotMovement.findMany({
      where: { lotId },
      include: {
        fromChamber: { select: { name: true } },
        toChamber: { select: { name: true } },
        fromRack: { select: { name: true } },
        toRack: { select: { name: true } },
        movedByUser: { select: { name: true } },
      },
      orderBy: { movedAt: 'desc' },
    });
    return movements.map((m) => ({
      id: m.id,
      lot_id: m.lotId,
      movement_type: m.movementType,
      from_chamber_id: m.fromChamberId,
      from_chamber_name: m.fromChamber?.name ?? null,
      to_chamber_id: m.toChamberId,
      to_chamber_name: m.toChamber?.name ?? null,
      from_rack_id: m.fromRackId,
      from_rack_name: m.fromRack?.name ?? null,
      to_rack_id: m.toRackId,
      to_rack_name: m.toRack?.name ?? null,
      bags: m.bags,
      reason: m.reason,
      moved_by: m.movedBy,
      moved_by_name: m.movedByUser?.name ?? null,
      moved_at: m.movedAt.toISOString(),
    }));
  }
}
