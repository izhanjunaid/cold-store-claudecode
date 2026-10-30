import { ServiceChargeRepository } from './service-charge.repository';
import { Errors } from '../../common/errors';
import { resolveFacilitySettings } from '../facility/facility.service';

interface ServiceChargeRecord {
  id: string;
  facilityId: string;
  name: string;
  unitType: string;
  unitPricePkr: { toString(): string };
  isActive: boolean;
  applyAtDispatch: boolean;
  createdAt: Date;
}

function toResponse(sc: ServiceChargeRecord) {
  return {
    id: sc.id,
    facility_id: sc.facilityId,
    name: sc.name,
    unit_type: sc.unitType,
    unit_price_pkr: Number(sc.unitPricePkr),
    is_active: sc.isActive,
    apply_at_dispatch: sc.applyAtDispatch,
    created_at: sc.createdAt.toISOString(),
  };
}

export class ServiceChargeService {
  constructor(private readonly repo: ServiceChargeRepository) {}

  async list(facilityId: string, isActive?: boolean) {
    const charges = await this.repo.findMany(facilityId, isActive);
    return (charges as ServiceChargeRecord[]).map(toResponse);
  }

  async getById(facilityId: string, id: string) {
    const sc = await this.repo.findById(facilityId, id);
    if (!sc) throw Errors.VALIDATION_ERROR('Service charge not found');
    return toResponse(sc as ServiceChargeRecord);
  }

  async create(input: {
    facilityId: string;
    name: string;
    unitType: 'PER_BAG' | 'PER_TON' | 'FLAT';
    unitPricePkr: number;
    applyAtDispatch?: boolean;
  }) {
    const existing = await this.repo.findByName(input.facilityId, input.name);
    if (existing) {
      throw Errors.VALIDATION_ERROR(`Service charge "${input.name}" already exists`, 'name');
    }
    await this.refusePerTonWhileWeightsHidden(input.facilityId, input.unitType, true);
    const sc = await this.repo.create({
      facilityId: input.facilityId,
      name: input.name,
      unitType: input.unitType,
      unitPricePkr: input.unitPricePkr,
      ...(input.applyAtDispatch !== undefined && { applyAtDispatch: input.applyAtDispatch }),
    });
    return toResponse(sc as ServiceChargeRecord);
  }

  async update(
    facilityId: string,
    id: string,
    input: {
      name?: string;
      unitType?: 'PER_BAG' | 'PER_TON' | 'FLAT';
      unitPricePkr?: number;
      isActive?: boolean;
      applyAtDispatch?: boolean;
    },
  ) {
    const sc = (await this.repo.findById(facilityId, id)) as ServiceChargeRecord | null;
    if (!sc) throw Errors.VALIDATION_ERROR('Service charge not found');
    await this.refusePerTonWhileWeightsHidden(facilityId, input.unitType ?? sc.unitType, input.isActive ?? sc.isActive);
    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.unitType !== undefined && { unitType: input.unitType }),
      ...(input.unitPricePkr !== undefined && { unitPricePkr: input.unitPricePkr }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.applyAtDispatch !== undefined && { applyAtDispatch: input.applyAtDispatch }),
    });
    return toResponse(updated as ServiceChargeRecord);
  }

  /** With weights hidden nothing records a weight, so no charge may end up active and priced per ton (docs/27). */
  private async refusePerTonWhileWeightsHidden(facilityId: string, unitType: string, isActive: boolean) {
    if (unitType !== 'PER_TON' || !isActive) return;
    if (resolveFacilitySettings(await this.repo.facilitySettings(facilityId)).hide_weights) {
      throw Errors.VALIDATION_ERROR(
        'Weights are switched off in Settings, so a charge cannot be priced per ton',
        'unit_type',
      );
    }
  }

  async deactivate(facilityId: string, id: string) {
    const sc = await this.repo.findById(facilityId, id);
    if (!sc) throw Errors.VALIDATION_ERROR('Service charge not found');
    await this.repo.deactivate(id);
    return { message: 'Service charge deactivated' };
  }
}
