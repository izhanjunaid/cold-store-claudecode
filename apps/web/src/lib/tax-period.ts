import { addDays, fromIsoDate, localIsoDate, monthEnd, periodOf, toIsoDate } from '@coldchain/shared';

/**
 * The latest tax period that has actually closed on or before `to`.
 *
 * NOT the month containing `to`. Tax is paid over after a period ends, and the
 * server refuses a payment date earlier than the period end — so deriving the
 * period from the month the report happens to end in meant the withholding
 * report's "Pay over" button asked to settle an unfinished month and was
 * refused every time.
 *
 * A `to` date that IS a month end settles that month; anything earlier settles
 * the month before. `to` comes from an <input type="date"> the user can clear,
 * so an unparseable value means the viewer's today rather than "undefined NaN".
 * Calendar math is the shared UTC module's (docs/25 L-39).
 */
export function periodToSettle(to: string): { year: number; month: number; label: string } {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(to) && !Number.isNaN(fromIsoDate(to).getTime()) ? to : localIsoDate();
  const { year: y, month: m } = periodOf(fromIsoDate(iso));
  const closed = iso === toIsoDate(monthEnd(y, m)) ? iso : addDays(`${iso.slice(0, 8)}01`, -1);
  const { year, month } = periodOf(fromIsoDate(closed));
  const label = fromIsoDate(closed).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { year, month, label };
}
