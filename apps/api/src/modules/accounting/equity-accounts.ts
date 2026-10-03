import { SYSTEM_ACCOUNTS, type JournalSource } from '@coldchain/shared';

/**
 * What an equity account is, in one place (docs/25 L-22).
 *
 * An account's role is READ, never inferred: a partner's capital and drawings
 * accounts are the ones their `partners` row names, and the plug, retained
 * earnings and the current-year result are registry roles. Reading it off the
 * normal balance — as the statements used to — made the plug an owner's capital,
 * counted opening-balance entries as capital introduced, and could not tell a
 * partner's drawings from any other debit-normal equity account.
 */

export type EquityRole =
  | 'PARTNER_CAPITAL'
  | 'PARTNER_DRAWINGS'
  | 'OPENING_BALANCE_EQUITY'
  | 'RETAINED_EARNINGS'
  | 'CURRENT_YEAR_RESULT'
  | 'OTHER';

export type EquityAccountRole = { role: EquityRole; partner_id: string | null; partner_name: string | null };

type PartnerAccounts = { id: string; name: string; capitalAccountCode: string; drawingsAccountCode: string };

/** The role of every equity account, keyed by code; an account nobody names is OTHER. */
export function equityRoles(partners: PartnerAccounts[]): (code: string) => EquityAccountRole {
  const byCode = new Map<string, EquityAccountRole>([
    [SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY, { role: 'OPENING_BALANCE_EQUITY', partner_id: null, partner_name: null }],
    [SYSTEM_ACCOUNTS.RETAINED_EARNINGS, { role: 'RETAINED_EARNINGS', partner_id: null, partner_name: null }],
    [SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT, { role: 'CURRENT_YEAR_RESULT', partner_id: null, partner_name: null }],
  ]);
  for (const p of partners) {
    byCode.set(p.capitalAccountCode, { role: 'PARTNER_CAPITAL', partner_id: p.id, partner_name: p.name });
    byCode.set(p.drawingsAccountCode, { role: 'PARTNER_DRAWINGS', partner_id: p.id, partner_name: p.name });
  }
  return (code) => byCode.get(code) ?? { role: 'OTHER', partner_id: null, partner_name: null };
}

/**
 * Journal sources that are an owner putting money in or taking it out. A movement
 * on a partner's account from anything else — an opening balance, attributing
 * the plug, a manual correction — is presented as another movement, not as
 * capital introduced or drawings.
 */
export const OWNER_MOVEMENT_SOURCES: JournalSource[] = ['owner_equity_movements', 'owner_equity'];
