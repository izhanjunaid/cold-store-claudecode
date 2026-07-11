import { describe, it, expect } from 'vitest';
import { planTrim } from './placement.service';

describe('planTrim — largest-first placement trimming', () => {
  it('trims entirely from the largest placement when it covers the excess', () => {
    const trims = planTrim(
      [
        { rackId: 'a', bags: 300 },
        { rackId: 'b', bags: 200 },
      ],
      150,
    );
    expect(trims).toEqual([{ rackId: 'a', bags: 150 }]);
  });

  it('spills into the next placement when the largest is exhausted', () => {
    const trims = planTrim(
      [
        { rackId: 'a', bags: 100 },
        { rackId: 'b', bags: 80 },
      ],
      150,
    );
    expect(trims).toEqual([
      { rackId: 'a', bags: 100 },
      { rackId: 'b', bags: 50 },
    ]);
  });

  it('clears everything when excess equals the placed total', () => {
    const trims = planTrim(
      [
        { rackId: 'a', bags: 60 },
        { rackId: 'b', bags: 40 },
      ],
      100,
    );
    expect(trims).toEqual([
      { rackId: 'a', bags: 60 },
      { rackId: 'b', bags: 40 },
    ]);
  });

  it('caps at the placed total when excess exceeds it', () => {
    const trims = planTrim([{ rackId: 'a', bags: 30 }], 100);
    expect(trims).toEqual([{ rackId: 'a', bags: 30 }]);
  });

  it('returns nothing for zero excess or no placements', () => {
    expect(planTrim([{ rackId: 'a', bags: 10 }], 0)).toEqual([]);
    expect(planTrim([], 50)).toEqual([]);
  });

  it('does not mutate the input order', () => {
    const input = [
      { rackId: 'small', bags: 10 },
      { rackId: 'big', bags: 90 },
    ];
    planTrim(input, 20);
    expect(input[0]!.rackId).toBe('small');
  });
});
