import { businessDate, fromIsoDate } from '@coldchain/shared';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Today at the facility (Lahore), as the UTC-midnight Date the reports compare DATE columns with. */
export function startOfToday(now: Date = new Date()): Date {
  return fromIsoDate(businessDate(now));
}

export function parseDateOnly(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
