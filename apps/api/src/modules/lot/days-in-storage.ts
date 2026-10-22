import { businessDate, fromIsoDate } from '@coldchain/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days a lot has been in, counted to `asOf` — by default today at the facility (Lahore),
 * the same day the dashboard and lot-aging count to, so the lot page never says one day less.
 */
export function daysInStorage(inboundDate: Date, asOf: Date = fromIsoDate(businessDate())): number {
  const diff = Math.floor((asOf.getTime() - inboundDate.getTime()) / DAY_MS);
  return Math.max(0, diff);
}
