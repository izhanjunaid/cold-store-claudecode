import { describe, it, expect } from 'vitest';
import { computeTariffCharge, Tariff } from '@coldchain/shared';
import { TARIFF_PRESETS, tariffIssue } from './tariff-fields';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('tariff presets', () => {
  it.each(TARIFF_PRESETS.map((p) => [p.label, p] as const))('%s is a valid rule as shipped', (_label, preset) => {
    expect(Tariff.safeParse(preset.tariff).success).toBe(true);
    // Only the season preset needs the plan's season end; every other one is complete by itself.
    const season = preset.tariff.opening.type === 'SEASON';
    expect(tariffIssue(preset.tariff, season ? '2026-03-31' : '')).toBeNull();
    expect(tariffIssue(preset.tariff, '')).toBe(season ? 'A season fee needs a season end date' : null);
  });

  it('the apple preset bills ½ month, then a month, then days', () => {
    const apple = TARIFF_PRESETS.find((p) => p.id === 'apple')!;
    const r = computeTariffCharge(
      { monthRatePkr: 30, minBillingDays: 1, tariff: apple.tariff },
      100,
      d('2026-01-01'),
      d('2026-02-20'),
    );
    expect(r.breakdown.map((b) => b.label)).toEqual(['½ month', '1 month', '5 days']);
    expect(r.amountPkr).toBe(5000);
  });

  it('flags a rule the server would refuse, in words, before the form is sent', () => {
    const bad = { ...Tariff.parse({}), opening: { type: 'SPLIT_MONTH' as const, split_day: 15 } };
    expect(tariffIssue(bad, '')).toMatch(/calendar/i);
  });
});
