import type { RateType } from '@coldchain/db';

export interface StorageChargeInput {
  rateType: RateType;
  rateAmountPkr: number;
  quantityBags: number;
  periodStart: Date;
  periodEnd: Date;
  minBillingDays: number;
}

export interface StorageChargeResult {
  description: string;
  quantity: number;
  unitPricePkr: number;
  amountPkr: number;
  days: number;
}

export function computeStorageCharge(input: StorageChargeInput): StorageChargeResult {
  if (input.quantityBags <= 0) throw new Error('quantityBags must be positive');

  const diffMs = input.periodEnd.getTime() - input.periodStart.getTime();
  const rawDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const days = Math.max(rawDays, input.minBillingDays);

  const rate = input.rateAmountPkr;
  const qty = input.quantityBags;

  if (input.rateType === 'SEASONAL_PER_BAG') {
    return {
      description: `Storage (Seasonal) — ${qty} bags × Rs.${rate}`,
      quantity: qty,
      unitPricePkr: rate,
      amountPkr: round2(qty * rate),
      days,
    };
  }

  if (input.rateType === 'MONTHLY_PER_BAG') {
    const months = Math.ceil(days / 30);
    return {
      description: `Storage (Monthly) — ${qty} bags × Rs.${rate} × ${months} month(s)`,
      quantity: qty,
      unitPricePkr: rate,
      amountPkr: round2(qty * rate * months),
      days,
    };
  }

  // DAILY_PER_BAG
  return {
    description: `Storage (Daily) — ${qty} bags × Rs.${rate} × ${days} day(s)`,
    quantity: qty,
    unitPricePkr: rate,
    amountPkr: round2(qty * rate * days),
    days,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
