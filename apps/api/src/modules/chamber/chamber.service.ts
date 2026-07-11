import { ChamberRepository } from './chamber.repository';
import { renderRackLabels } from '../pdf/pdf.service';
import { Errors } from '../../common/errors';
interface ChamberRecord {
  id: string;
  facilityId: string;
  name: string;
  commodityRestrictionId: string | null;
  maxCapacityBags: number;
  temperatureMinC: { toNumber(): number } | null;
  temperatureMaxC: { toNumber(): number } | null;
  isActive: boolean;
  notes: string | null;
  commodityRestriction?: { id: string; name: string } | null;
}

interface TempLogRecord {
  id: string;
  chamberId: string;
  temperatureC: { toNumber(): number };
  recordedAt: Date;
  recordedBy: string;
  source: string;
  recordedByUser?: { name: string } | null;
}

function toChamberResponse(
  chamber: ChamberRecord,
  lastTemp: TempLogRecord | null = null,
  occupancyBags: number = 0,
) {
  const available = Math.max(0, chamber.maxCapacityBags - occupancyBags);
  return {
    id: chamber.id,
    facility_id: chamber.facilityId,
    name: chamber.name,
    commodity_restriction_id: chamber.commodityRestrictionId ?? null,
    commodity_restriction_name: chamber.commodityRestriction?.name ?? null,
    max_capacity_bags: chamber.maxCapacityBags,
    current_occupancy_bags: occupancyBags,
    available_capacity_bags: available,
    temperature_min_c: chamber.temperatureMinC ? Number(chamber.temperatureMinC) : null,
    temperature_max_c: chamber.temperatureMaxC ? Number(chamber.temperatureMaxC) : null,
    is_active: chamber.isActive,
    notes: chamber.notes ?? null,
    last_temperature: lastTemp ? {
      temperature_c: Number(lastTemp.temperatureC),
      recorded_at: lastTemp.recordedAt.toISOString(),
      source: lastTemp.source,
    } : null,
  };
}

interface RackRecord {
  id: string;
  chamberId: string;
  name: string;
  maxCapacityBags: number;
  position: number;
  isActive: boolean;
  notes: string | null;
}

function toRackResponse(rack: RackRecord, occupancyBags: number = 0) {
  return {
    id: rack.id,
    chamber_id: rack.chamberId,
    name: rack.name,
    max_capacity_bags: rack.maxCapacityBags,
    current_occupancy_bags: occupancyBags,
    position: rack.position,
    is_active: rack.isActive,
    notes: rack.notes ?? null,
  };
}

function toTempLogResponse(log: TempLogRecord) {
  return {
    id: log.id,
    chamber_id: log.chamberId,
    temperature_c: Number(log.temperatureC),
    recorded_at: log.recordedAt.toISOString(),
    recorded_by: log.recordedBy,
    recorded_by_name: log.recordedByUser?.name,
    source: log.source,
  };
}

export class ChamberService {
  constructor(private readonly repo: ChamberRepository) {}

  async list(facilityId: string, isActive?: boolean) {
    const chambers = await this.repo.findMany(facilityId, isActive);
    const chamberIds = chambers.map((c) => c.id);
    const occupancy = await this.repo.getOccupancyByChamberIds(chamberIds);
    const rackCounts = await this.repo.countRacksByChamberIds(chamberIds);
    const results = [];
    for (const chamber of chambers) {
      const lastTemp = await this.repo.getLastTemperature(chamber.id);
      results.push({
        ...toChamberResponse(
          chamber as ChamberRecord,
          lastTemp as TempLogRecord | null,
          occupancy.get(chamber.id) ?? 0,
        ),
        rack_count: rackCounts.get(chamber.id) ?? 0,
      });
    }
    return results;
  }

  async getById(facilityId: string, id: string) {
    const chamber = await this.repo.findById(facilityId, id);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');
    const lastTemp = await this.repo.getLastTemperature(id);
    const temperatureLogs = await this.repo.getTemperatureLogs(id);
    const occupancy = await this.repo.getOccupancyByChamberIds([id]);
    const racks = (await this.repo.findRacksByChamber(id)) as RackRecord[];
    const rackOccupancy = await this.repo.getRackOccupancy(racks.map((r) => r.id));
    const placedTotal = await this.repo.getPlacedTotalByChamber(id);
    const chamberOccupancy = occupancy.get(id) ?? 0;
    return {
      ...toChamberResponse(
        chamber as ChamberRecord,
        lastTemp as TempLogRecord | null,
        chamberOccupancy,
      ),
      rack_count: racks.length,
      racks: racks.map((r) => toRackResponse(r, rackOccupancy.get(r.id) ?? 0)),
      unplaced_bags: Math.max(0, chamberOccupancy - placedTotal),
      temperature_logs: (temperatureLogs as TempLogRecord[]).map(toTempLogResponse),
    };
  }

  // ── Racks ─────────────────────────────────────────────────────

  async createRack(facilityId: string, chamberId: string, input: {
    name: string;
    maxCapacityBags: number;
    position?: number;
    notes?: string;
  }) {
    const chamber = await this.repo.findById(facilityId, chamberId);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');
    try {
      const rack = await this.repo.createRack({
        facilityId,
        chamberId,
        name: input.name,
        maxCapacityBags: input.maxCapacityBags,
        position: input.position ?? 0,
        notes: input.notes,
      });
      return toRackResponse(rack as RackRecord);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw Errors.VALIDATION_ERROR('A rack with this name already exists in this room', 'name');
      }
      throw err;
    }
  }

  async updateRack(facilityId: string, rackId: string, input: {
    name?: string;
    maxCapacityBags?: number;
    position?: number;
    notes?: string;
    isActive?: boolean;
  }) {
    const rack = await this.repo.findRackById(facilityId, rackId);
    if (!rack) throw Errors.VALIDATION_ERROR('Rack not found');

    if (input.isActive === false) {
      const placements = await this.repo.countActivePlacements(rackId);
      if (placements > 0) {
        throw Errors.VALIDATION_ERROR(
          'Rack holds placed stock and cannot be deactivated. Move the lots first.',
          'is_active',
        );
      }
    }

    try {
      const updated = await this.repo.updateRack(rackId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.maxCapacityBags !== undefined && { maxCapacityBags: input.maxCapacityBags }),
        ...(input.position !== undefined && { position: input.position }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      });
      const occupancy = await this.repo.getRackOccupancy([rackId]);
      return toRackResponse(updated as RackRecord, occupancy.get(rackId) ?? 0);
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        throw Errors.VALIDATION_ERROR('A rack with this name already exists in this room', 'name');
      }
      throw err;
    }
  }

  async getRackLabelsPdf(
    facilityId: string,
    chamberId: string,
  ): Promise<{ filename: string; pdf: Buffer }> {
    const chamber = await this.repo.findById(facilityId, chamberId);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');
    const racks = (await this.repo.findRacksByChamber(chamberId)) as RackRecord[];
    const activeRacks = racks.filter((r) => r.isActive);
    if (activeRacks.length === 0) {
      throw Errors.VALIDATION_ERROR('This room has no active racks to print labels for');
    }
    const facilityName = await this.repo.getFacilityName(facilityId);
    const pdf = await renderRackLabels({
      facilityName: facilityName ?? 'ColdChain',
      roomName: chamber.name,
      racks: activeRacks.map((r) => ({ name: r.name, maxCapacityBags: r.maxCapacityBags })),
    });
    return { filename: `${chamber.name.replace(/\s+/g, '-')}-rack-labels.pdf`, pdf };
  }

  async getRackLots(facilityId: string, rackId: string) {
    const rack = await this.repo.findRackById(facilityId, rackId);
    if (!rack) throw Errors.VALIDATION_ERROR('Rack not found');
    const placements = await this.repo.getRackLots(rackId);
    return placements.map((p) => ({
      lot_id: p.lot.id,
      lot_number: p.lot.lotNumber,
      owner_party_name: p.lot.ownerParty?.name ?? null,
      commodity_name: p.lot.commodity?.name ?? null,
      marka: p.lot.marka ?? null,
      bags: p.bags,
    }));
  }

  async create(facilityId: string, input: {
    name: string;
    commodityRestrictionId?: string | null;
    maxCapacityBags: number;
    temperatureMinC?: number;
    temperatureMaxC?: number;
    notes?: string;
  }) {
    const chamber = await this.repo.create({
      facilityId,
      name: input.name,
      commodityRestrictionId: input.commodityRestrictionId ?? null,
      maxCapacityBags: input.maxCapacityBags,
      temperatureMinC: input.temperatureMinC,
      temperatureMaxC: input.temperatureMaxC,
      notes: input.notes,
    });
    return toChamberResponse(chamber as ChamberRecord);
  }

  async update(facilityId: string, id: string, input: {
    name?: string;
    commodityRestrictionId?: string | null;
    maxCapacityBags?: number;
    temperatureMinC?: number;
    temperatureMaxC?: number;
    notes?: string;
  }) {
    const chamber = await this.repo.findById(facilityId, id);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');

    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.commodityRestrictionId !== undefined && { commodityRestrictionId: input.commodityRestrictionId }),
      ...(input.maxCapacityBags !== undefined && { maxCapacityBags: input.maxCapacityBags }),
      ...(input.temperatureMinC !== undefined && { temperatureMinC: input.temperatureMinC }),
      ...(input.temperatureMaxC !== undefined && { temperatureMaxC: input.temperatureMaxC }),
      ...(input.notes !== undefined && { notes: input.notes }),
    });
    return toChamberResponse(updated as ChamberRecord);
  }

  async logTemperature(facilityId: string, chamberId: string, userId: string, input: {
    temperatureC: number;
    recordedAt?: string;
    source: string;
  }) {
    const chamber = await this.repo.findById(facilityId, chamberId);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');

    const log = await this.repo.logTemperature({
      chamberId,
      temperatureC: input.temperatureC,
      recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      recordedBy: userId,
      source: input.source as 'MANUAL' | 'SENSOR',
    });
    return toTempLogResponse(log as TempLogRecord);
  }
}
