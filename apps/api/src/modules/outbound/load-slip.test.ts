import { describe, it, expect } from 'vitest';
import { slipTime } from './load-slip';

describe('the load slip prints the facility clock', () => {
  it('a slip printed at 03:30 in Lahore (22:30 UTC the day before) carries the Lahore date and time', () => {
    expect(slipTime(new Date('2026-10-20T22:30:00Z'))).toBe('21 Oct 2026, 03:30');
  });
});
