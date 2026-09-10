/**
 * What the equity accounts mean, in one place.
 *
 * Equity is the one class where an account's *role* is inferred rather than
 * declared: nothing records that an account belongs to a partner, so the
 * statements read it off the normal balance. That inference was written three
 * times independently — the statements, the JE-30 owner-equity endpoint, and the
 * opening-balance plug — and three copies of a rule this load-bearing will
 * eventually disagree. They live here instead.
 *
 * The predicates are structural rather than lists of codes on purpose: per-partner
 * accounts are created by the owner, never seeded, so no list can know them.
 */

/** Fields the rules actually read. Both Prisma rows and slimmer selects satisfy it. */
export type EquityAccountShape = {
  accountCode: string;
  accountClass: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
};

/**
 * Retained earnings and the current-year result. Both are computed by the
 * statements from the P&L accounts (virtual closing — no closing entry is ever
 * posted), so neither may be the equity side of an owner movement or of an
 * opening balance: whatever were posted there would be double-counted.
 */
export const DERIVED_EQUITY_ACCOUNTS = ['3020', '3030'] as const;

/**
 * Where the guided opening-balance entry balances to — and nothing else.
 *
 * `docs/17` Finding 17 and `docs/21` §2 kept this as the owner's capital account
 * rather than a separate "Opening Balance Equity", because an OBE account that
 * must be cleared by hand is the classic source of stale suspense balances. The
 * objection was sound, but it rested on *nobody noticing* the leftover — and the
 * balance is now reported on the opening-balance screen and on the face of the
 * balance sheet, so noticing is no longer the problem.
 *
 * What did not survive was the account doing two jobs. As a sole proprietor's
 * real capital account AND the plug, no name could be right for both, and on a
 * two-owner facility the capital half belonged to nobody. Every owner now has a
 * named account under 3100 instead — a sole one included — and this account means
 * only "not yet attributed".
 */
export const EQUITY_PLUG_ACCOUNT = '3010';

const DERIVED = new Set<string>(DERIVED_EQUITY_ACCOUNTS);

/** Contra-equity: a partner's drawings account. Being DEBIT-normal is what makes it one. */
export function isDrawingsAccount(a: EquityAccountShape): boolean {
  return a.accountClass === 'EQUITY' && a.accountType === 'DETAIL' && a.normalBalance === 'DEBIT';
}

/** A partner's capital account: equity that is not drawings and not derived. */
export function isCapitalAccount(a: EquityAccountShape): boolean {
  return (
    a.accountClass === 'EQUITY' &&
    a.accountType === 'DETAIL' &&
    a.normalBalance === 'CREDIT' &&
    !DERIVED.has(a.accountCode)
  );
}

/**
 * How much opening equity is sitting in the plug, unattributed.
 *
 * There is no "not applicable" case any more. While 3010 was called Owner’s
 * Capital it did two jobs — a sole proprietor’s real capital account AND the
 * plug — so a balance there was only sometimes a problem, and this took the whole
 * chart to work out which. Every owner now has a named account under 3100,
 * including a sole one, so anything left here is unattributed by definition.
 *
 * Zero is the healthy answer and means attributed in full; it is not a warning.
 *
 * Callers reach the balance differently — the balance sheet already has an
 * aggregate in hand, the opening-balance status endpoint queries for one — but
 * they round it here, so the screen and the statement can never show an owner two
 * different figures for the same rupees.
 */
export function unattributedPlug(plugCreditBalance: number): number {
  return Math.round(plugCreditBalance * 100) / 100;
}
