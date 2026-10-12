import { z } from 'zod';
import { round2 } from './money';
import type { RateType } from './schemas/enums';

/** How a rate reads after "Rs. 30 / …" on a receipt or a picker. One map for every screen and PDF. */
export const RATE_UNIT_LABEL: Record<RateType, string> = {
  SEASONAL_PER_BAG: 'bag (season)',
  MONTHLY_PER_BAG: 'bag per month',
  DAILY_PER_BAG: 'bag per day',
  TARIFF_PER_BAG: 'bag per month (custom tariff)',
};

/**
 * The stepped storage tariffs Lahore cold stores actually use ("adhi" month, then
 * months, then days; calendar split months; a season fee plus an extension). One rule
 * shape expresses all of them so a new client is a new rate plan, not a code change.
 *
 * Only the *shape* lives in the JSON. The monthly rate, the minimum-days floor and the
 * season end stay in their own rate-plan columns, so no value is stored twice and the
 * rate freeze (docs/25 R-29) still guards all of them.
 *
 * ORDER OF OPERATIONS, on the days from billing start to the out date (the in-day counts,
 * the out-day does not):
 *   1. Opening takes its stretch first and is always charged in full, even when the stay
 *      is shorter than it (it acts as a minimum).
 *        BLOCK        the first `days`, charged `months_charged` months
 *        SPLIT_MONTH  the rest of the arrival calendar month: a full month if the lot
 *                     arrived on or before `split_day`, else half
 *        SEASON       everything up to the plan's season end, charged `fee`; a lot that
 *                     arrives after the season end pays ordinary rates, no fee
 *   2. Whole months of what is left (30-day blocks or real calendar months).
 *   3. The leftover days: free up to `grace_days`; beyond that charged by `mode`.
 *   4. The total is never below `minBillingDays` days of rent.
 */

const nonNeg = z.number().min(0);

const Opening = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }),
  z.object({
    type: z.literal('BLOCK'),
    days: z.number().int().min(1).max(366),
    months_charged: z.number().positive().max(12),
  }),
  z.object({ type: z.literal('SPLIT_MONTH'), split_day: z.number().int().min(1).max(28) }),
  z.object({ type: z.literal('SEASON'), fee: z.number().positive() }),
]);

const Remainder = z.object({
  grace_days: z.number().int().min(0).max(30).default(0),
  mode: z.enum(['DAILY', 'HALF_OR_FULL', 'FULL_MONTH']).default('DAILY'),
  half_month_days: z.number().int().min(1).max(30).default(15),
});

export const Tariff = z
  .object({
    day_rate: nonNeg.nullable().default(null),
    month_counting: z.enum(['DAYS_30', 'CALENDAR']).default('DAYS_30'),
    opening: Opening.default({ type: 'NONE' }),
    remainder: Remainder.default({}),
  })
  .superRefine((t, ctx) => {
    const bad = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });
    if (t.opening.type === 'SPLIT_MONTH' && t.month_counting !== 'CALENDAR') {
      bad('A split month needs calendar months', ['month_counting']);
    }
    if (t.opening.type === 'BLOCK' && t.month_counting === 'CALENDAR') {
      bad('A fixed block of days cannot be combined with calendar months', ['month_counting']);
    }
    if (t.remainder.mode === 'HALF_OR_FULL' && t.remainder.grace_days >= t.remainder.half_month_days) {
      bad('Grace days must be fewer than the half-month cut-off', ['remainder', 'grace_days']);
    }
  });
export type Tariff = z.infer<typeof Tariff>;

/** Rules that depend on the rest of the plan, which the schema alone cannot see. */
export function tariffPlanIssue(tariff: Tariff, seasonEndDate: Date | null | undefined): string | null {
  if (tariff.opening.type === 'SEASON' && !seasonEndDate) {
    return 'A season fee needs a season end date';
  }
  return null;
}

export interface TariffInput {
  /** The plan's `rateAmountPkr`: per bag per month. */
  monthRatePkr: number;
  minBillingDays: number;
  seasonEndDate?: Date | null;
  tariff: Tariff;
}

export interface TariffCharge {
  /** What one bag pays, rounded to the paisa. */
  perBagPkr: number;
  amountPkr: number;
  days: number;
  /** The part of `perBagPkr` that is the season fee (0 unless the opening is SEASON). */
  seasonFeePerBagPkr: number;
  breakdown: { label: string; pkr: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (a: Date, b: Date) => Math.ceil((b.getTime() - a.getTime()) / DAY_MS);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** `d` plus `n` calendar months; 31 Jan + 1 month is 28 Feb, never a drift into March. */
function addMonths(d: Date, n: number): Date {
  const total = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), daysInMonth(y, m))));
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
export function formatMonths(m: number): string {
  if (m === 0.5) return '½ month';
  if (Number.isInteger(m)) return plural(m, 'month');
  return `${m} months`;
}

/** Whole months and leftover days between `cursor` and `end`. */
function monthsAndDays(counting: Tariff['month_counting'], cursor: Date, end: Date, remainingDays: number) {
  if (counting === 'DAYS_30') {
    return { months: Math.floor(remainingDays / 30), days: remainingDays % 30 };
  }
  if (end <= cursor) return { months: 0, days: 0 };
  let months = 0;
  while (addMonths(cursor, months + 1) <= end) months++;
  return { months, days: daysBetween(addMonths(cursor, months), end) };
}

export function computeTariffCharge(plan: TariffInput, bags: number, start: Date, end: Date): TariffCharge {
  if (bags <= 0) throw new Error('quantityBags must be positive');
  const { tariff, monthRatePkr: monthRate } = plan;
  const dayRate = tariff.day_rate ?? monthRate / 30;
  const rawDays = Math.max(daysBetween(start, end), 0);

  const lines: { label: string; pkr: number }[] = [];
  const add = (label: string, pkr: number) => {
    if (pkr > 0) lines.push({ label, pkr });
  };

  // 1. Opening.
  let cursor = start;
  let remaining = rawDays;
  let seasonFee = 0;
  const o = tariff.opening;
  if (o.type === 'BLOCK') {
    add(formatMonths(o.months_charged), o.months_charged * monthRate);
    remaining = Math.max(rawDays - o.days, 0);
  } else if (o.type === 'SPLIT_MONTH') {
    const half = start.getUTCDate() > o.split_day;
    add(half ? '½ month' : '1 month', (half ? 0.5 : 1) * monthRate);
    cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    remaining = Math.max(daysBetween(cursor, end), 0);
  } else if (o.type === 'SEASON' && plan.seasonEndDate && start <= plan.seasonEndDate) {
    seasonFee = o.fee;
    add('season fee', o.fee);
    cursor = plan.seasonEndDate;
    remaining = Math.max(daysBetween(cursor, end), 0);
  }

  // 2. Whole months.
  const { months, days: left } = monthsAndDays(tariff.month_counting, cursor, end, remaining);
  add(formatMonths(months), months * monthRate);

  // 3. Leftover days.
  const r = tariff.remainder;
  if (left > r.grace_days) {
    if (r.mode === 'DAILY') add(plural(left, 'day'), left * dayRate);
    else if (r.mode === 'FULL_MONTH' || left > r.half_month_days) add('1 month', monthRate);
    else add('½ month', monthRate / 2);
  }

  // 4. Minimum.
  let perBag = lines.reduce((s, l) => s + l.pkr, 0);
  const floor = plan.minBillingDays * dayRate;
  if (perBag < floor) {
    perBag = floor;
    lines.length = 0;
    add(`minimum ${plural(plan.minBillingDays, 'day')}`, floor);
  }

  const perBagPkr = round2(perBag);
  return {
    perBagPkr,
    amountPkr: round2(bags * perBagPkr),
    days: Math.max(rawDays, plan.minBillingDays),
    seasonFeePerBagPkr: seasonFee,
    breakdown: lines.map((l) => ({ label: l.label, pkr: round2(l.pkr) })),
  };
}
