/**
 * Statement periods — presets, comparatives and the period line — on the shared
 * calendar module (@coldchain/shared fiscal.ts), which the API uses too.
 *
 * This file used to do its own date math with local-time getters and
 * `new Date('YYYY-MM-DD')`, which JavaScript parses as UTC midnight and the local
 * getters then read as the previous day west of Greenwich (docs/25 L-39). Now
 * every date is a calendar date (`YYYY-MM-DD`) handled in UTC; the one local
 * question — "what day is it for this viewer?" — is `localIsoDate`.
 */
import {
  DEFAULT_FY_START_MONTH,
  addDays,
  fiscalYearBounds,
  fromIsoDate,
  localIsoDate,
  monthEnd,
  monthStart,
  toIsoDate,
  type IsoDate,
} from '@coldchain/shared';

export { DEFAULT_FY_START_MONTH };

export type PresetKey = 'this_month' | 'last_month' | 'this_quarter' | 'ytd' | 'this_fy' | 'last_fy' | 'custom';

export interface PeriodRange {
  /** inclusive period start (P&L / TB) */
  date_from: string;
  /** inclusive period end (P&L / TB) and as-of date (Balance Sheet) */
  date_to: string;
  /** balance-sheet as-of (== date_to) */
  as_of: string;
  label: string;
}

const monthLabel = (iso: IsoDate) =>
  fromIsoDate(iso).toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });

function fyLabel(start: IsoDate, end: IsoDate): string {
  const [sy, ey] = [start.slice(0, 4), end.slice(0, 4)];
  return sy === ey ? `FY ${sy}` : `FY ${sy}–${ey.slice(2)}`;
}

const range = (date_from: IsoDate, date_to: IsoDate, label: string): PeriodRange => ({
  date_from,
  date_to,
  as_of: date_to,
  label,
});

/** Resolve a preset to a concrete date range. `ref` is the viewer's own today. */
export function presetRange(
  key: PresetKey,
  fyStartMonth: number = DEFAULT_FY_START_MONTH,
  ref: Date = new Date(),
): PeriodRange {
  const today = localIsoDate(ref);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)); // 1-12

  switch (key) {
    case 'this_month': {
      const from = toIsoDate(monthStart(y, m));
      return range(from, toIsoDate(monthEnd(y, m)), monthLabel(from));
    }
    case 'last_month': {
      const from = toIsoDate(monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1));
      return range(from, addDays(toIsoDate(monthStart(y, m)), -1), monthLabel(from));
    }
    case 'this_quarter': {
      // The fiscal quarter containing today: quarters run from the FY start.
      const fy = fiscalYearBounds(today, fyStartMonth);
      const monthsIn = (y - Number(fy.start.slice(0, 4))) * 12 + (m - fyStartMonth);
      const q = Math.floor(monthsIn / 3);
      const startMonthIndex = fyStartMonth - 1 + q * 3; // 0-based, may pass 11
      const qStartYear = Number(fy.start.slice(0, 4)) + Math.floor(startMonthIndex / 12);
      const qStartMonth = (startMonthIndex % 12) + 1;
      const from = toIsoDate(monthStart(qStartYear, qStartMonth));
      const endIndex = startMonthIndex + 2;
      const to = toIsoDate(monthEnd(Number(fy.start.slice(0, 4)) + Math.floor(endIndex / 12), (endIndex % 12) + 1));
      return range(from, to, `Q${q + 1} ${fyLabel(fy.start, fy.end)}`);
    }
    case 'ytd':
      return range(`${y}-01-01`, today, `${y} YTD`);
    case 'this_fy': {
      const { start, end } = fiscalYearBounds(today, fyStartMonth);
      return range(start, end, fyLabel(start, end));
    }
    case 'last_fy': {
      const { start, end } = fiscalYearBounds(addDays(fiscalYearBounds(today, fyStartMonth).start, -1), fyStartMonth);
      return range(start, end, fyLabel(start, end));
    }
    case 'custom':
    default:
      return range(fiscalYearBounds(today, fyStartMonth).start, today, 'Custom');
  }
}

export type CompareMode = 'year' | 'period';

/** The same calendar date a number of years away; 29 February lands on the 28th. */
function shiftYears(iso: IsoDate, delta: number): IsoDate {
  const d = fromIsoDate(iso);
  const y = d.getUTCFullYear() + delta;
  const last = monthEnd(y, d.getUTCMonth() + 1).getUTCDate();
  return toIsoDate(new Date(Date.UTC(y, d.getUTCMonth(), Math.min(d.getUTCDate(), last))));
}

/** Derive the comparative (prior) period for a given range. */
export function priorRange(r: PeriodRange, mode: CompareMode = 'year'): PeriodRange {
  if (mode === 'year') {
    return {
      date_from: shiftYears(r.date_from, -1),
      date_to: shiftYears(r.date_to, -1),
      as_of: shiftYears(r.as_of, -1),
      label: 'Prior year',
    };
  }
  // The contiguous preceding period of the same length.
  const to = addDays(r.date_from, -1);
  const lengthDays = Math.round((fromIsoDate(r.date_to).getTime() - fromIsoDate(r.date_from).getTime()) / 86_400_000);
  return { date_from: addDays(to, -lengthDays), date_to: to, as_of: to, label: 'Prior period' };
}

/** Long human period line for the statement frame. */
export function describePeriod(r: { date_from?: string; date_to: string }, kind: 'period' | 'as_of'): string {
  const fmt = (s: string) =>
    fromIsoDate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (kind === 'as_of') return `As at ${fmt(r.date_to)}`;
  if (r.date_from) return `For the period ${fmt(r.date_from)} to ${fmt(r.date_to)}`;
  return `Up to ${fmt(r.date_to)}`;
}

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'ytd', label: 'Calendar YTD' },
  { key: 'this_fy', label: 'This Fiscal Year' },
  { key: 'last_fy', label: 'Last Fiscal Year' },
  { key: 'custom', label: 'Custom…' },
];
