import { Tariff, tariffPlanIssue } from '@coldchain/shared';
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
  tariff?: unknown;
  isActive: boolean;
  createdAt: Date;
  commodity?: { id: string; name: string } | null;
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

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
    tariff: plan.tariff ? (plan.tariff as Tariff) : null,
    is_active: plan.isActive,
    created_at: plan.createdAt.toISOString(),
  };
}

interface CreateInput {
  facilityId: string;
  name: string;
  commodityId?: string | null;
  rateType: 'SEASONAL_PER_BAG' | 'MONTHLY_PER_BAG' | 'DAILY_PER_BAG' | 'TARIFF_PER_BAG';
  rateAmountPkr: number;
  seasonStartDate?: string;
  seasonEndDate?: string;
  minBillingDays: number;
  tariff?: Tariff;
}

interface UpdateInput {
  name?: string;
  commodityId?: string | null;
  rateAmountPkr?: number;
  seasonStartDate?: string | null;
  seasonEndDate?: string | null;
  minBillingDays?: number;
  tariff?: Tariff;
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
      tariff: input.tariff ?? undefined,
    });
    return toResponse(plan as RatePlanRecord);
  }

  async update(facilityId: string, id: string, input: UpdateInput) {
    const plan = await this.repo.findById(facilityId, id);
    if (!plan) throw Errors.VALIDATION_ERROR('Rate plan not found');

    const record = plan as RatePlanRecord;
    if (input.tariff !== undefined && record.rateType !== 'TARIFF_PER_BAG') {
      throw Errors.VALIDATION_ERROR('Only a custom-tariff plan has a tariff', 'tariff');
    }
    const seasonEnd = input.seasonEndDate !== undefined ? input.seasonEndDate : isoDate(record.seasonEndDate);
    const tariff = input.tariff ?? (record.tariff ? Tariff.parse(record.tariff) : null);
    const issue = tariff && tariffPlanIssue(tariff, seasonEnd ? new Date(seasonEnd) : null);
    if (issue) throw Errors.VALIDATION_ERROR(issue, 'season_end_date');

    // A plan's rates price storage already rendered on every lot that uses it, so
    // once any lot does they are frozen — a new rate is a new plan (docs/25 R-29).
    // Frozen means *changed*: the edit form echoes every field, so a field that is
    // merely present must not trip the freeze.
    const changesRates =
      (input.rateAmountPkr !== undefined && input.rateAmountPkr !== Number(record.rateAmountPkr)) ||
      (input.seasonStartDate !== undefined && (input.seasonStartDate ?? null) !== isoDate(record.seasonStartDate)) ||
      (input.seasonEndDate !== undefined && (input.seasonEndDate ?? null) !== isoDate(record.seasonEndDate)) ||
      (input.minBillingDays !== undefined && input.minBillingDays !== record.minBillingDays) ||
      (input.tariff !== undefined && JSON.stringify(input.tariff) !== JSON.stringify(Tariff.parse(record.tariff)));
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
      ...(input.tariff !== undefined && { tariff: input.tariff }),
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
