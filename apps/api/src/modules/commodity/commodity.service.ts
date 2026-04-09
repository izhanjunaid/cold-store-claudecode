import { CommodityRepository } from './commodity.repository';
import { Errors } from '../../common/errors';

interface CommodityRecord {
  id: string;
  name: string;
  unitLabel: string;
  defaultStorageDaysAlert: number | null;
  isActive: boolean;
  varieties?: VarietyRecord[];
}

interface VarietyRecord {
  id: string;
  commodityId: string;
  name: string;
  isActive: boolean;
}

function toCommodityResponse(c: CommodityRecord) {
  return {
    id: c.id,
    name: c.name,
    unit_label: c.unitLabel,
    default_storage_days_alert: c.defaultStorageDaysAlert ?? null,
    is_active: c.isActive,
    varieties: c.varieties?.map(v => ({
      id: v.id,
      name: v.name,
      is_active: v.isActive,
    })),
  };
}

function toVarietyResponse(v: VarietyRecord) {
  return {
    id: v.id,
    commodity_id: v.commodityId,
    name: v.name,
    is_active: v.isActive,
  };
}

export class CommodityService {
  constructor(private readonly repo: CommodityRepository) {}

  async list() {
    const commodities = await this.repo.findAll();
    return (commodities as CommodityRecord[]).map(toCommodityResponse);
  }

  async create(input: { name: string; unitLabel: string; defaultStorageDaysAlert?: number }) {
    const commodity = await this.repo.create({
      name: input.name,
      unitLabel: input.unitLabel,
      defaultStorageDaysAlert: input.defaultStorageDaysAlert,
    });
    return toCommodityResponse(commodity as CommodityRecord);
  }

  async update(id: string, input: { name?: string; unitLabel?: string; defaultStorageDaysAlert?: number }) {
    const commodity = await this.repo.findById(id);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.unitLabel !== undefined && { unitLabel: input.unitLabel }),
      ...(input.defaultStorageDaysAlert !== undefined && { defaultStorageDaysAlert: input.defaultStorageDaysAlert }),
    });
    return toCommodityResponse(updated as CommodityRecord);
  }

  async listVarieties(commodityId: string) {
    const commodity = await this.repo.findById(commodityId);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    const varieties = await this.repo.findVarietiesByCommodity(commodityId);
    return (varieties as VarietyRecord[]).map(toVarietyResponse);
  }

  async createVariety(commodityId: string, name: string) {
    const commodity = await this.repo.findById(commodityId);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    const variety = await this.repo.createVariety({ commodityId, name });
    return toVarietyResponse(variety as VarietyRecord);
  }
}
