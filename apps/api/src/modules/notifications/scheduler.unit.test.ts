import { describe, it, expect } from 'vitest';
import { isDigestDue } from './scheduler';

// Local time 2026-07-14, given hour.
const at = (hour: number) => new Date(2026, 6, 14, hour, 0, 0);
const notif = (over: Partial<{ daily_digest_enabled: boolean; digest_hour: number }> = {}) => ({
  daily_digest_enabled: true,
  digest_hour: 8,
  ...over,
});

describe('isDigestDue', () => {
  it('is due when enabled, the hour matches, and none sent today', () => {
    expect(isDigestDue(notif(), {}, at(8))).toBe(true);
  });

  it('is not due when the digest is disabled', () => {
    expect(isDigestDue(notif({ daily_digest_enabled: false }), {}, at(8))).toBe(false);
  });

  it('is not due at a different hour', () => {
    expect(isDigestDue(notif(), {}, at(9))).toBe(false);
  });

  it('is not due when already sent today', () => {
    const today = at(8).toISOString().slice(0, 10);
    expect(isDigestDue(notif(), { last_digest_date: today }, at(8))).toBe(false);
  });

  it('is due again once the stored date is in the past', () => {
    expect(isDigestDue(notif(), { last_digest_date: '2026-07-13' }, at(8))).toBe(true);
  });

  it('is not due when notifications are unset', () => {
    expect(isDigestDue(undefined, {}, at(8))).toBe(false);
  });
});
