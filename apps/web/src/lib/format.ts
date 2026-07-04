/**
 * App-wide display formats for operational screens.
 *
 * One format per data type, everywhere: money is "Rs 1,234,567", dates are
 * "22 Jun 2026", timestamps are "22 Jun 2026, 13:07". Financial statements
 * keep their own accounting conventions (parenthesised negatives, em-dash
 * zeros) — see accounting-format.ts.
 */

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const DATE_TIME_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function toDate(d: string | number | Date | null | undefined): Date | null {
  if (d === null || d === undefined || d === '') return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Rs 1,234,567" — the facility currency is PKR everywhere, so the short prefix reads best. */
export function formatMoney(n: number | null | undefined, opts: { dp?: number } = {}): string {
  const dp = opts.dp ?? 0;
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `Rs ${n.toLocaleString('en-PK', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`;
}

/** "22 Jun 2026" — unambiguous day/month order; matches the statement headers. */
export function formatDate(d: string | number | Date | null | undefined): string {
  const date = toDate(d);
  return date ? DATE_FMT.format(date) : '—';
}

/** "22 Jun 2026, 13:07" — no seconds; nobody schedules cold storage to the second. */
export function formatDateTime(d: string | number | Date | null | undefined): string {
  const date = toDate(d);
  return date ? DATE_TIME_FMT.format(date) : '—';
}

/** "1,234" — plain counts (bags, lots). */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}
