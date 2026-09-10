import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/owner-equity',
}));

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));

const accounts = vi.fn();
vi.mock('@/hooks/use-reference-data', () => ({
  useAccounts: () => ({ data: accounts() }),
}));

import OwnerEquityPage from './page';

const acct = (
  account_code: string,
  account_name: string,
  normal_balance: 'DEBIT' | 'CREDIT',
  account_class = 'EQUITY',
  parent_account_code: string | null = null,
) => ({
  account_code,
  account_name,
  account_class,
  account_type: 'DETAIL' as const,
  parent_account_code,
  normal_balance,
  is_active: true,
});

const BANK = acct('1020', 'Bank Account — Main', 'DEBIT', 'ASSET', '1000');
const PLUG = acct('3010', 'Opening Balance Equity', 'CREDIT');

/**
 * 3010 is where the opening-balance entry balances to, not a person. It used to
 * appear in this picker labelled "(opening balances)" — a warning standing in for
 * a barrier — because while it doubled as a sole proprietor's capital account,
 * hiding it would have left that facility with nothing to choose. Every owner now
 * has a named account under 3100, so it is excluded outright.
 */
describe('OwnerEquityPage — the plug is not an owner', () => {
  beforeEach(() => accounts.mockReset());

  it('keeps 3010 out of the owner dropdown entirely', async () => {
    accounts.mockReturnValue([
      PLUG,
      acct('3110', 'Junaid — Capital', 'CREDIT', 'EQUITY', '3100'),
      acct('3210', 'Junaid — Drawings', 'DEBIT', 'EQUITY', '3200'),
      BANK,
    ]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: /Junaid — Capital/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /3010/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Opening Balance Equity/ })).toBeNull();
  });

  it('says what to create when the facility has no owner accounts yet', async () => {
    // The empty picker is a real state now, and it has one specific remedy —
    // so it is named rather than left as a dropdown with nothing in it.
    accounts.mockReturnValue([PLUG, BANK]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByText(/No owner accounts exist yet/)).toBeTruthy());
    expect(screen.queryByRole('option', { name: /3010/ })).toBeNull();
  });

  it('leaves out the accounts the statements work out for themselves', async () => {
    accounts.mockReturnValue([
      acct('3110', 'Junaid — Capital', 'CREDIT', 'EQUITY', '3100'),
      acct('3020', 'Retained Earnings', 'CREDIT'),
      acct('3030', 'Current Year Profit / (Loss)', 'CREDIT'),
      BANK,
    ]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: /Junaid — Capital/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Retained Earnings/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Current Year/ })).toBeNull();
  });

  it('offers both capital and drawings accounts — either side of a movement', async () => {
    accounts.mockReturnValue([
      acct('3110', 'Junaid — Capital', 'CREDIT', 'EQUITY', '3100'),
      acct('3210', 'Junaid — Drawings', 'DEBIT', 'EQUITY', '3200'),
      BANK,
    ]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: /Junaid — Capital/ })).toBeTruthy());
    expect(screen.getByRole('option', { name: /Junaid — Drawings/ })).toBeTruthy();
  });
});
