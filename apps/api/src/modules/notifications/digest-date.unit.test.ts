import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { digestDateLabel } from './digest.service';

// The API container runs in UTC: test the same way, whatever this machine's zone is.
let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env['TZ'];
  process.env['TZ'] = 'UTC';
});
afterAll(() => {
  if (previousTz === undefined) delete process.env['TZ'];
  else process.env['TZ'] = previousTz;
});

describe('the daily digest names the facility day', () => {
  it('a digest sent at 03:30 in Lahore (22:30 UTC the day before) is dated the Lahore day', () => {
    expect(digestDateLabel(new Date('2026-10-20T22:30:00Z'))).toBe('Wednesday, 21 October 2026');
  });

  it('in the afternoon the two clocks agree', () => {
    expect(digestDateLabel(new Date('2026-10-21T10:00:00Z'))).toBe('Wednesday, 21 October 2026');
  });
});
