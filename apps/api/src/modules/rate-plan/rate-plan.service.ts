import { RatePlanRepository } from './rate-plan.repository';
import { Errors } from '../../common/errors';

interface RatePlanRecord {
  id: string;
  facilityId: string;
  name: string;
  commodityId: string | null;
  rateType: string;
  rateAmountPkr: { toString(): string };
  seasonStartDate: Date | null;
  seasonEndDate: Date | null;
  minBillingDays: number;
  isActive: boolean;
  createdAt: Date;
  commodity?: { id: string; name: string } | null;
}

function toResponse(plan: RatePlanRecord) {
  return {
    id: plan.id,
    facility_id: plan.facilityId,
    name: plan.name,
    commodity_id: plan.commodityId,
    commodity_name: plan.commodity?.name ?? null,
    rate_type: plan.rateType,
    rate_amount_pkr: Number(plan.rateAmountPkr),
    season_start_date: plan.seasonStartDate ? plan.seasonStartDate.toISOString().slice(0, 10) : null,
    season_end_date: plan.seasonEndDate ? plan.seasonEndDate.toISOString().slice(0, 10) : null,
    min_billing_days: plan.minBillingDays,
    is_active: plan.isActive,
    created_at: plan.createdAt.toISOString(),
  };
}

interface CreateInput {
  facilityId: string;
  name: string;
  commodityId?: string | null;
  rateType: 'SEASONAL_PER_BAG' | 'MONTHLY_PER_BAG' | 'DAILY_PER_BAG';
  rateAmountPkr: number;
  seasonStartDate?: string;
  seasonEndDate?: string;
  minBillingDays: number;
}

interface UpdateInput {
  name?: string;
  commodityId?: string | null;
  rateAmountPkr?: number;
  seasonStartDate?: string | null;
  seasonEndDate?: string | null;
  minBillingDays?: number;
  isActive?: boolean;
}

export class RatePlanService {
  constructor(private readonly repo: RatePlanRepository) {}

  async list(facilityId: string, filters: { is_active?: boolean; commodity_id?: string }) {
    const plans = await this.repo.findMany(facilityId, {
      isActive: filters.is_active,
      commodityId: filters.commodity_id,
    });
    return (plans as RatePlanRecord[]).map(toResponse);
  }

  async getById(facilityId: string, id: string) {
    const plan = await this.repo.findById(facilityId, id);
    if (!plan) throw Errors.VALIDATION_ERROR('Rate plan not found');
    return toResponse(plan as RatePlanRecord);
  }

  async create(input: CreateInput) {
    if (input.rateType === 'SEASONAL_PER_BAG') {
      if (!input.seasonStartDate || !input.seasonEndDate) {
        throw Errors.VALIDATION_ERROR(
          'season_start_date and season_end_date are required for SEASONAL_PER_BAG',
        );
      }
    }
    const plan = await this.repo.create({
      facilityId: input.facilityId,
      name: input.name,
      commodityId: input.commodityId ?? null,
      rateType: input.rateType,
      rateAmountPkr: input.rateAmountPkr,
      seasonStartDate: input.seasonStartDate ? new Date(input.seasonStartDate) : null,
      seasonEndDate: input.seasonEndDate ? new Date(input.seasonEndDate) : null,
      minBillingDays: input.minBillingDays,
    });
    return toResponse(plan as RatePlanRecord);
  }

  async update(facilityId: string, id: string, input: UpdateInput) {
    const plan = await this.repo.findById(facilityId, id);
    if (!plan) throw Errors.VALIDATION_ERROR('Rate plan not found');

    // A plan's rates price storage already rendered on every lot that uses it, so
    // once any lot does they are frozen — a new rate is a new plan (docs/25 R-29).
    const changesRates =
      input.rateAmountPkr !== undefined ||
      input.seasonStartDate !== undefined ||
      input.seasonEndDate !== undefined ||
      input.minBillingDays !== undefined;
    if (changesRates && (await this.repo.isInUse(facilityId, id))) {
      throw Errors.VALIDATION_ERROR(
        'Lots are stored on this plan, so its rates can no longer change; create a new plan for the new rates',
        'rate_amount_pkr',
      );
    }

    const updated = await this.repo.update(id, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.commodityId !== undefined && { commodityId: input.commodityId }),
      ...(input.rateAmountPkr !== undefined && { rateAmountPkr: input.rateAmountPkr }),
      ...(input.seasonStartDate !== undefined && {
        seasonStartDate: input.seasonStartDate ? new Date(input.seasonStartDate) : null,
      }),
      ...(input.seasonEndDate !== undefined && {
        seasonEndDate: input.seasonEndDate ? new Date(input.seasonEndDate) : null,
      }),
      ...(input.minBillingDays !== undefined && { minBillingDays: input.minBillingDays }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    });
    return toResponse(updated as RatePlanRecord);
  }

  async deactivate(facilityId: string, id: string) {
    const plan = await this.repo.findById(facilityId, id);
    if (!plan) throw Errors.VALIDATION_ERROR('Rate plan not found');
    await this.repo.deactivate(id);
    return { message: 'Rate plan deactivated' };
  }
}
