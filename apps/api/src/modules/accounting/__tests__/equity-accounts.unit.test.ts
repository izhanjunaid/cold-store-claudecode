import { describe, it, expect } from 'vitest';
import { SYSTEM_ACCOUNTS } from '@coldchain/shared';
import { equityRoles } from '../equity-accounts';

/**
 * What an equity account is comes from the partners table and the registry —
 * never from its normal balance (docs/25 L-22). The inference this replaced made
 * the plug an owner's capital account and any debit-normal equity account a
 * partner's drawings.
 */
const partner = { id: '00000000-0000-0000-0000-00000000000a', name: 'Owner A', capitalAccountCode: '3110', drawingsAccountCode: '3210' };
const roleOf = equityRoles([partner]);

describe('equity roles', () => {
  it('names a partner’s own two accounts, with the partner', () => {
    expect(roleOf('3110')).toEqual({ role: 'PARTNER_CAPITAL', partner_id: partner.id, partner_name: 'Owner A' });
    expect(roleOf('3210')).toEqual({ role: 'PARTNER_DRAWINGS', partner_id: partner.id, partner_name: 'Owner A' });
  });

  it('gives the plug, retained earnings and the current-year result their registry roles', () => {
    expect(roleOf(SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY).role).toBe('OPENING_BALANCE_EQUITY');
    expect(roleOf(SYSTEM_ACCOUNTS.RETAINED_EARNINGS).role).toBe('RETAINED_EARNINGS');
    expect(roleOf(SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT).role).toBe('CURRENT_YEAR_RESULT');
  });

  it('calls any other equity account OTHER, whatever its normal balance', () => {
    // A legacy drawings account nobody adopted is not a partner's drawings.
    expect(roleOf('3015')).toEqual({ role: 'OTHER', partner_id: null, partner_name: null });
  });
});
