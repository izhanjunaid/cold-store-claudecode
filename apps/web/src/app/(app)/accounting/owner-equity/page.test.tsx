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
const PLUG = acct('3010', "Owner's Capital", 'CREDIT');

describe('OwnerEquityPage — the opening-balance plug must not read as a person', () => {
  beforeEach(() => accounts.mockReset());

  it('labels 3010 so its role is visible in the dropdown', async () => {
    accounts.mockReturnValue([PLUG, BANK]);
    render(<OwnerEquityPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Owner's Capital \(opening balances\)/ })).toBeTruthy(),
    );
  });

  it('warns against picking it once the owners have their own accounts', async () => {
    accounts.mockReturnValue([
      PLUG,
      acct('3011', 'Ali — Capital', 'CREDIT'),
      acct('3016', 'Ali — Drawings', 'DEBIT'),
      BANK,
    ]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByText(/is where opening balances balance to/)).toBeTruthy());
  });

  it('stays quiet on a single-owner facility, where 3010 IS the capital account', async () => {
    // The note would be wrong here: there is nothing else to use, and telling
    // someone not to pick the only option is worse than saying nothing.
    accounts.mockReturnValue([PLUG, acct('3015', "Owner's Drawings", 'DEBIT'), BANK]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByText(/Owner Capital/)).toBeTruthy());
    expect(screen.queryByText(/is where opening balances balance to/)).toBeNull();
  });

  it('never hides the plug — a single-owner facility would have an empty picker', async () => {
    accounts.mockReturnValue([PLUG, BANK]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: /3010/ })).toBeTruthy());
  });

  it('leaves out the accounts the statements work out for themselves', async () => {
    accounts.mockReturnValue([
      PLUG,
      acct('3020', 'Retained Earnings', 'CREDIT'),
      acct('3030', 'Current Year Profit / (Loss)', 'CREDIT'),
      BANK,
    ]);
    render(<OwnerEquityPage />);
    await waitFor(() => expect(screen.getByRole('option', { name: /3010/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Retained Earnings/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Current Year/ })).toBeNull();
  });
});
