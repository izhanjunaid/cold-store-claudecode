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
 * Where the guided opening-balance entry balances to.
 *
 * Deliberately the seeded owner's capital account rather than a separate
 * "Opening Balance Equity" account (`docs/17` Finding 17, `docs/21` §2): an OBE
 * account that has to be cleared by hand afterwards is the classic source of
 * stale suspense balances. For a sole proprietor the plug simply *is* their
 * capital and there is nothing left to clear.
 *
 * That reasoning holds only while there is one owner. With more than one, the
 * plug cannot be anybody's capital — see `isUnattributedPlug` below.
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
 * True where a balance left sitting in the plug belongs to nobody.
 *
 * A facility with one owner has exactly one capital account — the plug — and a
 * balance there is that owner's capital, correctly stated and needing nothing
 * further. Once the owners have accounts of their own, anything still in the plug
 * is opening equity nobody has attributed, and it appears on the balance sheet
 * indistinguishable from a real partner's capital.
 *
 * The asymmetry is the point: warning a sole proprietor about the only equity
 * account they have would be noise, and the same shape is already shipped in the
 * owner-equity picker.
 */
export function hasPartnerCapitalAccounts(accounts: EquityAccountShape[]): boolean {
  return accounts.some((a) => isCapitalAccount(a) && a.accountCode !== EQUITY_PLUG_ACCOUNT);
}

/**
 * How much opening equity is sitting in the plug unattributed, or `null` where
 * the question does not apply (a facility with a single owner).
 *
 * Callers reach the plug's balance differently — the balance sheet already has an
 * aggregate in hand, the opening-balance status endpoint queries for one — but
 * the *decision* of whether a balance counts as unattributed lives here, so the
 * two can never tell an owner different things about the same number.
 *
 * Zero is returned rather than null in the multi-partner case: "attributed in
 * full" is a meaningful answer and the caller may want to say so.
 */
export function unattributedPlug(
  accounts: EquityAccountShape[],
  plugCreditBalance: number,
): number | null {
  if (!hasPartnerCapitalAccounts(accounts)) return null;
  return Math.round(plugCreditBalance * 100) / 100;
}
