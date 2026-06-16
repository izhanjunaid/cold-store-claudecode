/**
 * Fiscal-period helpers for financial statements.
 * Pakistan's fiscal year runs 1 July – 30 June by default (override via
 * facility settings `fiscal_year_start_month`).
 */

export type PresetKey =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'ytd'
  | 'this_fy'
  | 'last_fy'
  | 'custom';

export interface PeriodRange {
  /** inclusive period start (P&L / TB) */
  date_from: string;
  /** inclusive period end (P&L / TB) and as-of date (Balance Sheet) */
  date_to: string;
  /** balance-sheet as-of (== date_to) */
  as_of: string;
  label: string;
}

export const DEFAULT_FY_START_MONTH = 7; // July

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function monthName(monthIndex0: number): string {
  return new Date(2000, monthIndex0, 1).toLocaleString('en', { month: 'short' });
}

/** Fiscal-year bounds for the FY that contains `ref`. */
function fyBounds(ref: Date, fyStartMonth: number): { start: Date; end: Date } {
  const m = ref.getMonth() + 1; // 1-12
  const startYear = m >= fyStartMonth ? ref.getFullYear() : ref.getFullYear() - 1;
  const start = new Date(startYear, fyStartMonth - 1, 1);
  const end = new Date(startYear + 1, fyStartMonth - 1, 0); // day 0 of next month = last day prior
  return { start, end };
}

/** Resolve a preset to a concrete date range. */
export function presetRange(
  key: PresetKey,
  fyStartMonth: number = DEFAULT_FY_START_MONTH,
  ref: Date = new Date(),
): PeriodRange {
  const y = ref.getFullYear();
  const m = ref.getMonth(); // 0-11

  switch (key) {
    case 'this_month': {
      const from = new Date(y, m, 1);
      const to = new Date(y, m + 1, 0);
      return { date_from: iso(from), date_to: iso(to), as_of: iso(to), label: `${monthName(m)} ${y}` };
    }
    case 'last_month': {
      const from = new Date(y, m - 1, 1);
      const to = new Date(y, m, 0);
      return { date_from: iso(from), date_to: iso(to), as_of: iso(to), label: `${monthName(from.getMonth())} ${from.getFullYear()}` };
    }
    case 'this_quarter': {
      const q = Math.floor(m / 3);
      const from = new Date(y, q * 3, 1);
      const to = new Date(y, q * 3 + 3, 0);
      return { date_from: iso(from), date_to: iso(to), as_of: iso(to), label: `Q${q + 1} ${y}` };
    }
    case 'ytd': {
      const from = new Date(y, 0, 1);
      return { date_from: iso(from), date_to: iso(ref), as_of: iso(ref), label: `${y} YTD` };
    }
    case 'this_fy': {
      const { start, end } = fyBounds(ref, fyStartMonth);
      return { date_from: iso(start), date_to: iso(end), as_of: iso(end), label: fyLabel(start, end) };
    }
    case 'last_fy': {
      const prevRef = new Date(y - 1, m, ref.getDate());
      const { start, end } = fyBounds(prevRef, fyStartMonth);
      return { date_from: iso(start), date_to: iso(end), as_of: iso(end), label: fyLabel(start, end) };
    }
    case 'custom':
    default: {
      const { start, end } = fyBounds(ref, fyStartMonth);
      return { date_from: iso(start), date_to: iso(ref), as_of: iso(ref), label: 'Custom' };
    }
  }
}

function fyLabel(start: Date, end: Date): string {
  if (start.getFullYear() === end.getFullYear()) return `FY ${start.getFullYear()}`;
  return `FY ${start.getFullYear()}–${String(end.getFullYear()).slice(2)}`;
}

export type CompareMode = 'year' | 'period';

function shiftYears(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  return iso(new Date(d.getFullYear() + delta, d.getMonth(), d.getDate()));
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + delta);
  return iso(d);
}

/** Derive the comparative (prior) period for a given range. */
export function priorRange(range: PeriodRange, mode: CompareMode = 'year'): PeriodRange {
  if (mode === 'year') {
    return {
      date_from: shiftYears(range.date_from, -1),
      date_to: shiftYears(range.date_to, -1),
      as_of: shiftYears(range.as_of, -1),
      label: 'Prior year',
    };
  }
  // contiguous preceding period of the same length
  const to = addDays(range.date_from, -1);
  const lengthDays = Math.round((new Date(range.date_to).getTime() - new Date(range.date_from).getTime()) / 86_400_000);
  const from = addDays(to, -lengthDays);
  return { date_from: from, date_to: to, as_of: to, label: 'Prior period' };
}

/** Long human period line for the statement frame. */
export function describePeriod(range: { date_from?: string; date_to: string }, kind: 'period' | 'as_of'): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  if (kind === 'as_of') return `As at ${fmt(range.date_to)}`;
  if (range.date_from) return `For the period ${fmt(range.date_from)} to ${fmt(range.date_to)}`;
  return `Up to ${fmt(range.date_to)}`;
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
