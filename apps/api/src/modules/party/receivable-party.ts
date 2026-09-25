import { AR_CONTROL_ACCOUNTS } from '@coldchain/shared';
import { Errors } from '../../common/errors';

/** A party as the receivable templates post it: whose it is and the account stamped on it. */
export type ReceivableParty = { id: string; name: string; controlAccountCode: string };

/** Select this wherever a party's receivable is about to be posted. */
export const RECEIVABLE_PARTY_SELECT = { id: true, name: true, controlAccountCode: true } as const;

/**
 * The party as a customer. Its AR account is the one stamped on the party row at
 * creation — never looked up from its type, which may since have changed (docs/25
 * R-01). A party whose account is not a receivable control (a supplier: Trade
 * Payables) is never invoiced and never pays a receipt.
 */
export function receivableParty(p: { id: string; name: string; controlAccountCode: string | null }): ReceivableParty {
  // The parties_default_control_account trigger fills every row, so null is a broken database, not input.
  if (!p.controlAccountCode) throw new Error(`Party ${p.id} has no control account`);
  if (!(AR_CONTROL_ACCOUNTS as readonly string[]).includes(p.controlAccountCode)) {
    throw Errors.VALIDATION_ERROR(
      `${p.name} is not a customer — its account ${p.controlAccountCode} is not a receivable`,
      'party_id',
    );
  }
  return { id: p.id, name: p.name, controlAccountCode: p.controlAccountCode };
}
