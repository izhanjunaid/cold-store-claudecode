import { businessDate, MANAGER_ALLOW_CODES, type ManagerAllowCode, type ManagerReasonCode } from '@coldchain/shared';

/**
 * What a manager has allowed on a withdrawal, still in force (docs/28 O8-O10). An allowance lasts the business
 * day (Lahore) it was given: from the next day it is history, and the row is a called row again.
 */
export function liveAllows(
  row: { managerAllows: string[]; managerAllowedAt: Date | null },
  today: string = businessDate(),
): Set<ManagerAllowCode> {
  if (!row.managerAllowedAt || businessDate(row.managerAllowedAt) !== today) return new Set();
  const known = MANAGER_ALLOW_CODES as readonly string[];
  return new Set(row.managerAllows.filter((c): c is ManagerAllowCode => known.includes(c)));
}

/**
 * What every one of a group's lines has allowed: a payment mode or credit is a (party, book) group's, so it is the
 * munshi's only where each line of the group carries it. An empty group allows nothing.
 */
export function allowedOnEvery(lines: ReadonlySet<ManagerAllowCode>[]): Set<ManagerAllowCode> {
  const [first, ...rest] = lines;
  return new Set([...(first ?? [])].filter((c) => rest.every((s) => s.has(c))));
}

/**
 * What a munshi's request asks beyond cash in full with every default charge kept, and the allowance that lifts
 * each: the refusal code, or null when nothing asked is out of reach. One function for the checkout's pre-check
 * and its re-check under the row lock, so they cannot drift. The skipped charge is named first, as it always was.
 * `creditApproved` is the party's standing approval; the ceiling is checked separately, under the party's lock.
 */
export function soloAskRefusal(
  ask: { skips: boolean; mode: string },
  creditApproved: boolean,
  live: ReadonlySet<ManagerAllowCode>,
): ManagerReasonCode | null {
  if (ask.skips && !live.has('LEAVE_CHARGE_OFF')) return 'SKIP_CHARGE';
  if (ask.mode === 'CREDIT') return creditApproved || live.has('CREDIT') ? null : 'NO_STANDING_CREDIT';
  if (ask.mode !== 'CASH' && !live.has('CHEQUE_OR_TRANSFER')) return 'PAYMENT_MODE';
  return null;
}
