import { describe, it, expect } from 'vitest';
import { isDigestDue, localDateString } from './scheduler';

// Local time 2026-07-14, given hour.
const at = (hour: number, minute = 0) => new Date(2026, 6, 14, hour, minute, 0);
const notif = (over: Partial<{ daily_digest_enabled: boolean; digest_hour: number }> = {}) => ({
  daily_digest_enabled: true,
  digest_hour: 8,
  ...over,
});

describe('localDateString', () => {
  it('formats the local calendar date as YYYY-MM-DD regardless of the machine timezone', () => {
    // Constructed from local components, so this is not affected by the
    // process's TZ — it must always read back the same date it was built with.
    expect(localDateString(new Date(2026, 6, 17, 2, 0, 0))).toBe('2026-07-17');
    expect(localDateString(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
    expect(localDateString(new Date(2026, 11, 31, 23, 59, 0))).toBe('2026-12-31');
  });

  it('zero-pads single-digit months and days', () => {
    expect(localDateString(new Date(2026, 2, 5, 12, 0, 0))).toBe('2026-03-05');
  });
});

describe('isDigestDue', () => {
  it('is due right at the target hour when none sent today', () => {
    expect(isDigestDue(notif(), {}, at(8))).toBe(true);
  });

  it('is not due when the digest is disabled', () => {
    expect(isDigestDue(notif({ daily_digest_enabled: false }), {}, at(8))).toBe(false);
  });

  it('is not due before the target hour', () => {
    expect(isDigestDue(notif(), {}, at(7))).toBe(false);
  });

  it('is due within the catch-up window after the target hour (box was off at digest_hour)', () => {
    expect(isDigestDue(notif(), {}, at(10))).toBe(true); // digest_hour + 2, still inside the default 3h window
  });

  it('is not due once the catch-up window has passed', () => {
    expect(isDigestDue(notif(), {}, at(11))).toBe(false); // digest_hour + 3 — window is [8, 11)
  });

  it('is not due when already sent today (checked against the local date)', () => {
    const today = localDateString(at(8));
    expect(isDigestDue(notif(), { last_digest_date: today }, at(8))).toBe(false);
  });

  it('does not resend within the catch-up window on the same local day', () => {
    const today = localDateString(at(10));
    expect(isDigestDue(notif(), { last_digest_date: today }, at(10))).toBe(false);
  });

  it('is due again once the stored date is in the past', () => {
    expect(isDigestDue(notif(), { last_digest_date: '2026-07-13' }, at(8))).toBe(true);
  });

  it('is not due when notifications are unset', () => {
    expect(isDigestDue(undefined, {}, at(8))).toBe(false);
  });

  it('honours a custom catch-up window', () => {
    expect(isDigestDue(notif(), {}, at(9), 1)).toBe(false); // digest_hour + 1, outside a 1h window
    expect(isDigestDue(notif(), {}, at(8), 1)).toBe(true);
  });

  it('regression: the local calendar date is used for dedup, not now.toISOString() (which is UTC and can disagree with local before/after midnight)', () => {
    // Simulate the exact failure mode this fixes: a UTC ISO date string
    // ('...toISOString().slice(0,10)') stored as last_digest_date would NOT
    // equal localDateString for a moment near local midnight in timezones
    // ahead of UTC (e.g. Asia/Karachi, UTC+5) — the old code judged "today"
    // from the wrong calendar date. isDigestDue must key off localDateString.
    const earlyMorning = at(2); // 02:00 local — well before digest_hour, irrelevant to the window,
    // this only asserts localDateString is what backs the dedup comparison.
    const localToday = localDateString(earlyMorning);
    const utcToday = earlyMorning.toISOString().slice(0, 10);
    // Assert the two candidate "today" strings are compared consistently:
    // isDigestDue must treat a stored *local* date as "already sent", not a
    // stored *UTC* date that happens to differ from it.
    expect(
      isDigestDue(notif({ digest_hour: earlyMorning.getHours() }), { last_digest_date: localToday }, earlyMorning),
    ).toBe(false);
    if (utcToday !== localToday) {
      expect(
        isDigestDue(notif({ digest_hour: earlyMorning.getHours() }), { last_digest_date: utcToday }, earlyMorning),
      ).toBe(true);
    }
  });
});
