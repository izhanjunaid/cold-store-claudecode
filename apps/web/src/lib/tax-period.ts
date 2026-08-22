export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The latest tax period that has actually closed on or before `to`.
 *
 * NOT the month containing `to`. Tax is paid over after a period ends, and the
 * server refuses a payment date earlier than the period end — so deriving the
 * period from the month the report happens to end in meant the withholding
 * report's "Pay over" button asked to settle an unfinished month and was
 * refused every time. Found in a browser click-through; the integration test
 * missed it because it passes an explicit, already-closed period.
 *
 * A `to` date that IS a month end settles that month; anything earlier settles
 * the month before. `to` comes from an <input type="date"> the user can clear,
 * so an unparseable value falls back to today rather than rendering
 * "undefined NaN" and posting NaN period fields.
 */
export function periodToSettle(to: string): { year: number; month: number; label: string } {
  const parsed = new Date(`${to}T00:00:00.000Z`);
  const end = Number.isNaN(parsed.getTime())
    ? new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
    : parsed;
  const lastOfMonth = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0));
  const closed =
    end.getTime() === lastOfMonth.getTime()
      ? end
      : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0));
  const year = closed.getUTCFullYear();
  const month = closed.getUTCMonth() + 1;
  return { year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
}
