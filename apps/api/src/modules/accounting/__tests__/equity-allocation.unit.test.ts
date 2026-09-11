import { describe, it, expect } from 'vitest';
import { sliceByRatio, divideByWeight, type RatioWindow, type PartnerShare } from '../equity-allocation';

const share = (id: string, weight: number): PartnerShare => ({
  partner_id: id,
  partner_name: id,
  capital_account_code: '31' + id,
  weight,
});

const ratio = (effective_from: string, ...shares: PartnerShare[]): RatioWindow => ({
  effective_from,
  shares,
});

/**
 * Cutting the period at each ratio change is the whole reason a ratio carries a
 * date. Admitting a partner mid-year has to split the result at the old ratio up
 * to the admission date and the new one after it — the part that is genuinely
 * error-prone by hand, and the answer to "will I have to move shares myself".
 */
describe('slicing the period at each ratio change', () => {
  const A = share('a', 1);
  const B = share('b', 1);
  const C = share('c', 1);

  it('returns one slice when nothing changed inside the period', () => {
    const slices = sliceByRatio('2026-01-01', '2026-12-31', [ratio('2025-01-01', A, B)]);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
    expect(slices[0]!.ratio!.effective_from).toBe('2025-01-01');
  });

  it('cuts the year a partner is admitted, at the admission date', () => {
    const slices = sliceByRatio('2026-01-01', '2026-12-31', [
      ratio('2025-01-01', A, B),
      ratio('2026-07-01', A, B, C),
    ]);
    expect(slices.map((s) => [s.from, s.to])).toEqual([
      ['2026-01-01', '2026-06-30'],
      ['2026-07-01', '2026-12-31'],
    ]);
    // Two owners before, three after — from one dated row, with nothing moved
    // by hand.
    expect(slices[0]!.ratio!.shares).toHaveLength(2);
    expect(slices[1]!.ratio!.shares).toHaveLength(3);
  });

  it('leaves the stretch before the first ratio unattached', () => {
    // Profit earned before the owners agreed anything belongs to nobody in
    // particular, and must not be divided on a ratio that did not yet exist.
    const slices = sliceByRatio('2026-01-01', '2026-12-31', [ratio('2026-07-01', A, B)]);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.ratio).toBeNull();
    expect(slices[1]!.ratio!.effective_from).toBe('2026-07-01');
  });

  it('uses the ratio in force at the start, not the earliest on record', () => {
    const slices = sliceByRatio('2026-01-01', '2026-03-31', [
      ratio('2020-01-01', A),
      ratio('2024-01-01', A, B),
    ]);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.ratio!.effective_from).toBe('2024-01-01');
  });

  it('ignores a ratio that starts after the period ends', () => {
    const slices = sliceByRatio('2026-01-01', '2026-06-30', [
      ratio('2026-01-01', A, B),
      ratio('2027-01-01', A, B, C),
    ]);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.ratio!.shares).toHaveLength(2);
  });

  it('handles a change on the first day of the period without an empty slice', () => {
    const slices = sliceByRatio('2026-01-01', '2026-12-31', [ratio('2026-01-01', A, B)]);
    expect(slices).toHaveLength(1);
    expect(slices[0]!.from).toBe('2026-01-01');
  });
});

/**
 * A statement that does not foot is worse than one that is a paisa uneven, so
 * the rounding difference has to land somewhere deliberate rather than be lost.
 */
describe('dividing the result by weight', () => {
  it('splits evenly on equal weights', () => {
    expect(divideByWeight(1000, [share('a', 1), share('b', 1)])).toEqual([
      { partner_id: 'a', amount_pkr: 500 },
      { partner_id: 'b', amount_pkr: 500 },
    ]);
  });

  it('treats weights as a ratio, not percentages', () => {
    // 3:1 and 75:25 are the same instruction; neither can fail to add to a whole.
    expect(divideByWeight(1000, [share('a', 3), share('b', 1)])).toEqual([
      { partner_id: 'a', amount_pkr: 750 },
      { partner_id: 'b', amount_pkr: 250 },
    ]);
    expect(divideByWeight(1000, [share('a', 75), share('b', 25)])).toEqual([
      { partner_id: 'a', amount_pkr: 750 },
      { partner_id: 'b', amount_pkr: 250 },
    ]);
  });

  it('preserves the total when the split does not divide evenly', () => {
    const parts = divideByWeight(100, [share('a', 1), share('b', 1), share('c', 1)]);
    expect(parts.reduce((t, p) => t + p.amount_pkr, 0)).toBe(100);
    // The largest weight absorbs the odd paisa; with equal weights it is the
    // first, deterministically — not whichever happened to be last.
    expect(parts.map((p) => p.amount_pkr).sort((x, y) => y - x)[0]).toBe(33.34);
  });

  it('preserves the total on a loss too', () => {
    const parts = divideByWeight(-100, [share('a', 1), share('b', 1), share('c', 1)]);
    expect(parts.reduce((t, p) => t + p.amount_pkr, 0)).toBe(-100);
  });

  it('gives nothing back when there is nobody to give it to', () => {
    expect(divideByWeight(1000, [])).toEqual([]);
  });
});
