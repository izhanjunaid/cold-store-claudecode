import { ServiceChargeRepository } from './service-charge.repository';
import { Errors } from '../../common/errors';

interface ServiceChargeRecord {
  id: string;
  facilityId: string;
  name: string;
  unitType: string;
  unitPricePkr: { toString(): string };
  isActive: boolean;
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
  }) {
    const existing = await this.repo.findByName(input.facilityId, input.name);
    if (existing) {
      throw Errors.VALIDATION_ERROR(`Service charge "${input.name}" already exists`, 'name');
    }
    const sc = await this.repo.create({
      facilityId: input.facilityId,
      name: input.name,
      unitType: input.unitType,
      unitPricePkr: input.unitPricePkr,
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
    },
  ) {
    const sc = await this.repo.findById(facilityId, id);
    if (!sc) throw Errors.VALIDATION_ERROR('Service charge not found');
    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.unitType !== undefined && { unitType: input.unitType }),
      ...(input.unitPricePkr !== undefined && { unitPricePkr: input.unitPricePkr }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    });
    return toResponse(updated as ServiceChargeRecord);
  }

  async deactivate(facilityId: string, id: string) {
    const sc = await this.repo.findById(facilityId, id);
    if (!sc) throw Errors.VALIDATION_ERROR('Service charge not found');
    await this.repo.deactivate(id);
    return { message: 'Service charge deactivated' };
  }
}
