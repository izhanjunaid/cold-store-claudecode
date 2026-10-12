import { describe, it, expect } from 'vitest';
import { computeTariffCharge, Tariff, tariffPlanIssue, type TariffInput } from '@coldchain/shared';

// Monthly rate 30 → default day rate 1, so every expected figure reads as "days of rent".
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const make = (
  tariff: unknown,
  extra: { monthRatePkr?: number; minBillingDays?: number; seasonEndDate?: Date | null } = {},
): TariffInput => ({
  monthRatePkr: extra.monthRatePkr ?? 30,
  minBillingDays: extra.minBillingDays ?? 1,
  seasonEndDate: extra.seasonEndDate ?? null,
  tariff: Tariff.parse(tariff),
});

const perBag = (plan: TariffInput, from: string, to: string) =>
  computeTariffCharge(plan, 1, d(from), d(to)).perBagPkr;

// ½ month first, then whole months, then leftover days at the daily rate.
const apple = make({ opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } });

describe('opening BLOCK (½ month, then months, then days)', () => {
  it('50 days = ½ month + 1 month + 5 days', () => {
    const r = computeTariffCharge(apple, 100, d('2026-01-01'), d('2026-02-20'));
    expect(r.days).toBe(50);
    expect(r.perBagPkr).toBe(50); // 15 + 30 + 5
    expect(r.amountPkr).toBe(5000);
    expect(r.breakdown.map((b) => b.label)).toEqual(['½ month', '1 month', '5 days']);
  });
  it('a stay inside the block still pays the whole block', () => {
    expect(perBag(apple, '2026-01-01', '2026-01-04')).toBe(15);
    expect(perBag(apple, '2026-01-01', '2026-01-16')).toBe(15); // exactly 15 days
  });
  it('day 16 adds one daily charge', () => {
    expect(perBag(apple, '2026-01-01', '2026-01-17')).toBe(16);
  });
  it('45 days = ½ month + 1 month, no leftover', () => {
    expect(perBag(apple, '2026-01-01', '2026-02-15')).toBe(45);
  });
});

describe('remainder modes', () => {
  const halfOrFull = make({ remainder: { mode: 'HALF_OR_FULL', half_month_days: 15 } });
  it('HALF_OR_FULL: 15 leftover days = ½ month, 16 = full month', () => {
    expect(perBag(halfOrFull, '2026-01-01', '2026-02-15')).toBe(45); // 45 days → 30 + 15 left
    expect(perBag(halfOrFull, '2026-01-01', '2026-02-16')).toBe(60); // 46 days → 30 + 16 left
  });
  it('FULL_MONTH: any leftover day pays a whole month (what ceil(days/30) does today)', () => {
    const p = make({ remainder: { mode: 'FULL_MONTH' } });
    expect(perBag(p, '2026-01-01', '2026-01-31')).toBe(30); // 30 days
    expect(perBag(p, '2026-01-01', '2026-02-01')).toBe(60); // 31 days
  });
  it('grace: leftover days up to the grace are free, the next day charges all of them', () => {
    const p = make({ remainder: { grace_days: 3, mode: 'DAILY' } });
    expect(perBag(p, '2026-01-01', '2026-02-03')).toBe(30); // 33 days → 3 left, free
    expect(perBag(p, '2026-01-01', '2026-02-04')).toBe(34); // 34 days → 4 left, charged
  });
  it('a separate day rate replaces monthly ÷ 30', () => {
    const p = make({ day_rate: 2 });
    expect(perBag(p, '2026-01-01', '2026-01-06')).toBe(10);
  });
});

describe('opening SPLIT_MONTH (calendar months, arrival after day N = ½ month)', () => {
  const split = make({ month_counting: 'CALENDAR', opening: { type: 'SPLIT_MONTH', split_day: 15 } });
  it('arrival after the 15th: ½ month, then whole calendar months, then days', () => {
    // 20 Sep → ½ month; Oct = 1 month; 1–8 Nov = 8 days
    expect(perBag(split, '2026-09-20', '2026-11-09')).toBe(53);
  });
  it('arrival on the 15th pays the full arrival month, on the 16th only half', () => {
    expect(perBag(split, '2026-09-15', '2026-09-20')).toBe(30);
    expect(perBag(split, '2026-09-16', '2026-09-20')).toBe(15);
  });
  it('calendar months are real months: February is one month, not 28 days', () => {
    // 20 Jan → ½; Feb = 1 month; 1–4 Mar = 4 days
    expect(perBag(split, '2026-01-20', '2026-03-05')).toBe(49);
  });
});

describe('CALENDAR month counting with no opening', () => {
  const cal = make({ month_counting: 'CALENDAR' });
  it('31 Jan → 28 Feb is one month, not a month and a bit', () => {
    expect(perBag(cal, '2026-01-31', '2026-02-28')).toBe(30);
  });
  it('15 Jan → 15 Mar is two months', () => {
    expect(perBag(cal, '2026-01-15', '2026-03-15')).toBe(60);
  });
});

describe('opening SEASON (fee up to the season end, then months and days)', () => {
  const season = make(
    { opening: { type: 'SEASON', fee: 120 } },
    { seasonEndDate: d('2026-03-31') },
  );
  it('lifted before or on the season end pays only the fee', () => {
    expect(perBag(season, '2026-01-01', '2026-02-10')).toBe(120);
    expect(perBag(season, '2026-01-01', '2026-03-31')).toBe(120);
  });
  it('past the season end the extension is billed from the season end', () => {
    expect(perBag(season, '2026-01-01', '2026-04-20')).toBe(140); // 20 days
    expect(perBag(season, '2026-01-01', '2026-05-10')).toBe(160); // 40 days = 1 month + 10 days
  });
  it('exposes the fee so the accrual can spread it', () => {
    const r = computeTariffCharge(season, 10, d('2026-01-01'), d('2026-04-20'));
    expect(r.seasonFeePerBagPkr).toBe(120);
    expect(r.perBagPkr - r.seasonFeePerBagPkr).toBe(20);
  });
  it('arriving after the season end is billed at the ordinary rates, no fee', () => {
    expect(perBag(season, '2026-04-10', '2026-04-20')).toBe(10);
  });
});

describe('minimum and money', () => {
  it('minBillingDays floors the charge at that many days of rent', () => {
    const p = make({}, { minBillingDays: 3 });
    expect(perBag(p, '2026-01-01', '2026-01-01')).toBe(3);
  });
  it('quantity × unit price = amount (docs/25 R-30) even with odd rates', () => {
    const p = make({ opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } }, { monthRatePkr: 33.33 });
    const r = computeTariffCharge(p, 7, d('2026-01-01'), d('2026-02-20'));
    expect(Math.round(7 * r.perBagPkr * 100) / 100).toBe(r.amountPkr);
  });
  it('zero bags is an error, like every other rate type', () => {
    expect(() => computeTariffCharge(apple, 0, d('2026-01-01'), d('2026-01-05'))).toThrow();
  });
});

describe('Tariff validation', () => {
  it('fills defaults so an empty rule is plain monthly ÷ 30 billing', () => {
    const t = Tariff.parse({});
    expect(t).toMatchObject({
      day_rate: null,
      month_counting: 'DAYS_30',
      opening: { type: 'NONE' },
      remainder: { grace_days: 0, mode: 'DAILY', half_month_days: 15 },
    });
  });
  it.each([
    ['SPLIT_MONTH needs calendar months', { opening: { type: 'SPLIT_MONTH', split_day: 15 } }],
    ['BLOCK cannot be combined with calendar months', { month_counting: 'CALENDAR', opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } }],
    ['negative grace', { remainder: { grace_days: -1 } }],
    ['grace must stay below the half-month cut-off', { remainder: { mode: 'HALF_OR_FULL', grace_days: 15, half_month_days: 15 } }],
    ['negative day rate', { day_rate: -1 }],
    ['split day out of range', { month_counting: 'CALENDAR', opening: { type: 'SPLIT_MONTH', split_day: 31 } }],
    ['zero-day block', { opening: { type: 'BLOCK', days: 0, months_charged: 0.5 } }],
  ])('rejects: %s', (_name, rule) => {
    expect(Tariff.safeParse(rule).success).toBe(false);
  });
  it('a SEASON opening needs the plan to have a season end', () => {
    const t = Tariff.parse({ opening: { type: 'SEASON', fee: 100 } });
    expect(tariffPlanIssue(t, null)).toMatch(/season/i);
    expect(tariffPlanIssue(t, d('2026-03-31'))).toBeNull();
    expect(tariffPlanIssue(Tariff.parse({}), null)).toBeNull();
  });
});
