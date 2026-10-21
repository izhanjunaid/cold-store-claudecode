import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isDigestDue } from './scheduler';

// The instant it is `hour` o'clock in Lahore (UTC+5) on 2026-07-14.
const at = (hour: number) => new Date(Date.UTC(2026, 6, 14, hour - 5, 0, 0));
const notif = (over: Partial<{ daily_digest_enabled: boolean; digest_hour: number }> = {}) => ({
  daily_digest_enabled: true,
  digest_hour: 8,
  ...over,
});

// The API container runs in UTC: run these the same way, whatever this machine's zone is.
let previousTz: string | undefined;
beforeAll(() => {
  previousTz = process.env['TZ'];
  process.env['TZ'] = 'UTC';
});
afterAll(() => {
  if (previousTz === undefined) delete process.env['TZ'];
  else process.env['TZ'] = previousTz;
});

describe('isDigestDue', () => {
  it('is due when enabled, the hour matches, and none sent today', () => {
    expect(isDigestDue(notif(), {}, at(8))).toBe(true);
  });

  it('reads the hour on the Lahore clock: 8 means 03:00 UTC, not 08:00 UTC', () => {
    expect(isDigestDue(notif(), {}, new Date('2026-10-20T03:00:00Z'))).toBe(true);
    expect(isDigestDue(notif(), {}, new Date('2026-10-20T08:00:00Z'))).toBe(false);
  });

  it('is not due when the digest is disabled', () => {
    expect(isDigestDue(notif({ daily_digest_enabled: false }), {}, at(8))).toBe(false);
  });

  it('is not due at a different hour', () => {
    expect(isDigestDue(notif(), {}, at(9))).toBe(false);
  });

  it('is not due when already sent today', () => {
    expect(isDigestDue(notif(), { last_digest_date: '2026-07-14' }, at(8))).toBe(false);
  });

  it('"today" is the Lahore day: a digest at 01:00 in Lahore is due though the UTC date is still yesterday', () => {
    const lateNight = new Date('2026-10-20T20:00:00Z'); // 01:00 on the 21st in Lahore
    expect(isDigestDue(notif({ digest_hour: 1 }), { last_digest_date: '2026-10-20' }, lateNight)).toBe(true);
  });

  it('is due again once the stored date is in the past', () => {
    expect(isDigestDue(notif(), { last_digest_date: '2026-07-13' }, at(8))).toBe(true);
  });

  it('is not due when notifications are unset', () => {
    expect(isDigestDue(undefined, {}, at(8))).toBe(false);
  });
});
