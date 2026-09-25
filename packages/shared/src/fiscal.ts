/**
 * Calendar and fiscal-year arithmetic, in one place for the API and the web.
 *
 * Accounting dates are calendar dates, not instants: `entry_date` is a Postgres DATE.
 * So everything here works on UTC-midnight `Date`s or `YYYY-MM-DD` strings and uses
 * UTC getters only — the answer must not depend on the server's or the browser's
 * time zone. The one exception is `localIsoDate`, which exists precisely to ask the
 * browser what day it is *for the person using it* (a form's "today" default); using
 * the UTC date there made every form default to yesterday between midnight and 05:00
 * Pakistan time (docs/25 L-39).
 */

export type IsoDate = string; // YYYY-MM-DD

/** Pakistan's fiscal year runs 1 July – 30 June. */
export const DEFAULT_FY_START_MONTH = 7;

export const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A calendar date as UTC midnight. */
export function fromIsoDate(iso: IsoDate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** The calendar date of a UTC-midnight Date. */
export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

/** Today in the viewer's own time zone — for form defaults only, never for posting logic on the server. */
export function localIsoDate(d: Date = new Date()): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(fromIsoDate(iso).getTime() + days * DAY_MS));
}

export function dayBefore(iso: IsoDate): IsoDate {
  return addDays(iso, -1);
}

/** The accounting period (1-based month) a date falls in. */
export function periodOf(d: Date): { year: number; month: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function monthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/** Last calendar day of the month, as UTC midnight. */
export function monthEnd(year: number, month: number): Date {
  return new Date(Date.UTC(year, month, 0));
}

/** First day of the fiscal year containing `asOf`. */
export function fiscalYearStart(asOf: Date, fyStartMonth: number): Date {
  const month = asOf.getUTCMonth() + 1;
  const year = month >= fyStartMonth ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, fyStartMonth - 1, 1));
}

/** First and last day of the fiscal year containing `asOf`. */
export function fiscalYearBounds(asOf: IsoDate, fyStartMonth: number): { start: IsoDate; end: IsoDate } {
  const start = fiscalYearStart(fromIsoDate(asOf), fyStartMonth);
  const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 0));
  return { start: toIsoDate(start), end: toIsoDate(end) };
}
