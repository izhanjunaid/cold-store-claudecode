export interface SurchargeRule {
  enabled: boolean;
  pct_per_month: number;
  grace_days: number;
}

export interface SurchargeComputation {
  daysOverdue: number;
  eligibleMonths: number;
  chargeableMonths: number;
  principalPkr: number;
  suggestedPkr: number;
}

const DAY_MS = 86_400_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Deterministic surcharge computation:
 *   - ages from the invoice date (no due-date concept exists; matches
 *     receivables-aging)
 *   - whole 30-day blocks beyond the grace period, no pro-rating
 *   - months already charged are subtracted, so re-applying within the
 *     same block yields 0 (idempotent)
 *   - principal = total - paid (prior surcharges excluded: simple,
 *     non-compounding; payments are deemed to settle principal first)
 */
export function computeSurcharge(params: {
  rule: SurchargeRule;
  invoiceDate: Date;
  asOf: Date;
  totalPkr: number;
  amountPaidPkr: number;
  monthsAlreadyCharged: number;
}): SurchargeComputation {
  const daysOverdue = Math.floor(
    (params.asOf.getTime() - params.invoiceDate.getTime()) / DAY_MS,
  );
  const principalPkr = round2(Math.max(0, params.totalPkr - params.amountPaidPkr));

  if (!params.rule.enabled || principalPkr <= 0.005) {
    return { daysOverdue, eligibleMonths: 0, chargeableMonths: 0, principalPkr, suggestedPkr: 0 };
  }

  const eligibleMonths = Math.max(
    0,
    Math.floor((daysOverdue - params.rule.grace_days) / 30),
  );
  const chargeableMonths = Math.max(0, eligibleMonths - params.monthsAlreadyCharged);
  const suggestedPkr = round2(
    principalPkr * (params.rule.pct_per_month / 100) * chargeableMonths,
  );

  return { daysOverdue, eligibleMonths, chargeableMonths, principalPkr, suggestedPkr };
}
