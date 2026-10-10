import type { RateType } from '@coldchain/db';
import { computeTariffCharge, round2, Tariff } from '@coldchain/shared';

export interface StorageChargeInput {
  rateType: RateType;
  rateAmountPkr: number;
  quantityBags: number;
  periodStart: Date;
  periodEnd: Date;
  minBillingDays: number;
  /** TARIFF_PER_BAG only: the plan's rule, and the season end it may refer to. */
  tariff?: unknown;
  seasonEndDate?: Date | null;
}

export interface StorageChargeResult {
  description: string;
  /** Bags (seasonal), bag-months (monthly) or bag-days (daily): quantity × unit price = amount. */
  quantity: number;
  unitPricePkr: number;
  amountPkr: number;
  days: number;
}

/**
 * Where the current owner's billing window starts: the latest INITIAL or
 * TRANSFER_IN ownership event, else the lot's inbound date. The one rule the
 * withdrawal invoice, the FULL-transfer bill and the revenue accrual share — the
 * accrual and the invoice never converge if they start the window differently
 * (docs/25 R-15).
 */
export function billingPeriodStart(lot: {
  inboundDate: Date;
  ownershipHistory: { eventType: string; effectiveDate: Date }[];
}): Date {
  const starts = lot.ownershipHistory
    .filter((h) => h.eventType === 'INITIAL' || h.eventType === 'TRANSFER_IN')
    .map((h) => h.effectiveDate.getTime());
  return starts.length > 0 ? new Date(Math.max(...starts)) : lot.inboundDate;
}

export function computeStorageCharge(input: StorageChargeInput): StorageChargeResult {
  if (input.quantityBags <= 0) throw new Error('quantityBags must be positive');

  const diffMs = input.periodEnd.getTime() - input.periodStart.getTime();
  const rawDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const days = Math.max(rawDays, input.minBillingDays);

  const rate = input.rateAmountPkr;
  const bags = input.quantityBags;

  if (input.rateType === 'SEASONAL_PER_BAG') {
    return {
      description: `Storage (Seasonal) — ${bags} bags × Rs.${rate}`,
      quantity: bags,
      unitPricePkr: rate,
      amountPkr: round2(bags * rate),
      days,
    };
  }

  if (input.rateType === 'MONTHLY_PER_BAG') {
    const months = Math.ceil(days / 30);
    return {
      description: `Storage (Monthly) — ${bags} bags × ${months} month(s) = ${bags * months} bag-months × Rs.${rate}`,
      quantity: bags * months,
      unitPricePkr: rate,
      amountPkr: round2(bags * months * rate),
      days,
    };
  }

  if (input.rateType === 'DAILY_PER_BAG') {
    return {
      description: `Storage (Daily) — ${bags} bags × ${days} day(s) = ${bags * days} bag-days × Rs.${rate}`,
      quantity: bags * days,
      unitPricePkr: rate,
      amountPkr: round2(bags * days * rate),
      days,
    };
  }

  if (input.rateType === 'TARIFF_PER_BAG') {
    if (!input.tariff) throw new Error('A TARIFF_PER_BAG rate plan has no tariff');
    const t = computeTariffCharge(
      {
        monthRatePkr: rate,
        minBillingDays: input.minBillingDays,
        seasonEndDate: input.seasonEndDate,
        tariff: Tariff.parse(input.tariff),
      },
      bags,
      input.periodStart,
      input.periodEnd,
    );
    return {
      description: `Storage — ${t.breakdown.map((b) => b.label).join(' + ') || 'no charge'} (Rs.${t.perBagPkr} per bag × ${bags} bags)`,
      quantity: bags,
      unitPricePkr: t.perBagPkr,
      amountPkr: t.amountPkr,
      days: t.days,
    };
  }

  // A new RateType must be billed deliberately — never silently as daily.
  const unhandled: never = input.rateType;
  throw new Error(`No storage charge rule for rate type ${String(unhandled)}`);
}
