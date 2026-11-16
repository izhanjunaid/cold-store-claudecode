import { CommodityRepository } from './commodity.repository';
import { Errors } from '../../common/errors';

interface CommodityRecord {
  id: string;
  name: string;
  unitLabel: string;
  unitName: string | null;
  unitNameUrdu: string | null;
  unitWeightKg: { toString(): string } | null;
  spaceFactor: { toString(): string };
  revenueAccountCode: string | null;
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
    unit_name: c.unitName ?? c.unitLabel,
    unit_name_urdu: c.unitNameUrdu,
    unit_weight_kg: c.unitWeightKg ? Number(c.unitWeightKg) : null,
    space_factor: Number(c.spaceFactor),
    revenue_account_code: c.revenueAccountCode,
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

export interface CommodityInput {
  name?: string;
  unitLabel?: string;
  unitName?: string;
  unitNameUrdu?: string | null;
  unitWeightKg?: number | null;
  spaceFactor?: number;
  revenueAccountCode?: string;
  defaultStorageDaysAlert?: number;
}

/** Only the fields that were sent. */
function fields(input: CommodityInput) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

export class CommodityService {
  constructor(private readonly repo: CommodityRepository) {}

  async list() {
    const commodities = await this.repo.findAll();
    return (commodities as CommodityRecord[]).map(toCommodityResponse);
  }

  async create(facilityId: string, input: CommodityInput & { name: string; unitLabel: string }) {
    await this.assertRevenueAccount(facilityId, input.revenueAccountCode);
    const commodity = await this.repo.create(fields(input) as never);
    return toCommodityResponse(commodity as unknown as CommodityRecord);
  }

  async update(facilityId: string, id: string, input: CommodityInput) {
    const commodity = await this.repo.findById(id);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    await this.assertRevenueAccount(facilityId, input.revenueAccountCode);
    const updated = await this.repo.update(id, fields(input));
    return toCommodityResponse(updated as unknown as CommodityRecord);
  }

  /** Rent on these goods posts to this account, so it must be one of the store's revenue accounts. */
  private async assertRevenueAccount(facilityId: string, code: string | undefined) {
    if (code === undefined) return;
    if (!(await this.repo.isRevenueAccount(facilityId, code))) {
      throw Errors.VALIDATION_ERROR('Choose one of your revenue accounts', 'revenue_account_code');
    }
  }

  async listVarieties(commodityId: string) {
    const commodity = await this.repo.findById(commodityId);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    const varieties = await this.repo.findVarietiesByCommodity(commodityId);
    return (varieties as VarietyRecord[]).map(toVarietyResponse);
  }

  /** Flat list of every variety (with commodity_id) — powers reference dropdowns like the lot form. */
  async listAllVarieties() {
    const varieties = await this.repo.findAllVarieties();
    return (varieties as VarietyRecord[]).map(toVarietyResponse);
  }

  async createVariety(commodityId: string, name: string) {
    const commodity = await this.repo.findById(commodityId);
    if (!commodity) throw Errors.VALIDATION_ERROR('Commodity not found');
    const variety = await this.repo.createVariety({ commodityId, name });
    return toVarietyResponse(variety as VarietyRecord);
  }
}
