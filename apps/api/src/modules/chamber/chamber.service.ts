import { ChamberRepository } from './chamber.repository';
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
    const occupancy = await this.repo.getOccupancyByChamberIds(
      chambers.map((c) => c.id),
    );
    const results = [];
    for (const chamber of chambers) {
      const lastTemp = await this.repo.getLastTemperature(chamber.id);
      results.push(toChamberResponse(
        chamber as ChamberRecord,
        lastTemp as TempLogRecord | null,
        occupancy.get(chamber.id) ?? 0,
      ));
    }
    return results;
  }

  async getById(facilityId: string, id: string) {
    const chamber = await this.repo.findById(facilityId, id);
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found');
    const lastTemp = await this.repo.getLastTemperature(id);
    const temperatureLogs = await this.repo.getTemperatureLogs(id);
    const occupancy = await this.repo.getOccupancyByChamberIds([id]);
    return {
      ...toChamberResponse(
        chamber as ChamberRecord,
        lastTemp as TempLogRecord | null,
        occupancy.get(id) ?? 0,
      ),
      temperature_logs: (temperatureLogs as TempLogRecord[]).map(toTempLogResponse),
    };
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
