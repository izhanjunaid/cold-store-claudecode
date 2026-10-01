import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/owner-equity',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));

const accounts = vi.fn();
vi.mock('@/hooks/use-reference-data', () => ({
  useAccounts: () => ({ data: accounts() }),
}));

import OwnerEquityPage from './page';

const acct = (account_code: string, account_name: string, is_cash_equivalent: boolean) => ({
  account_code,
  account_name,
  account_class: 'ASSET',
  account_type: 'DETAIL' as const,
  parent_account_code: null,
  normal_balance: 'DEBIT' as const,
  is_active: true,
  is_cash_equivalent,
  allow_manual_posting: true,
  requires_party: false,
});

const partner = (name: string, retired_on: string | null = null) => ({
  id: `${name}-id`,
  name,
  cnic: null,
  capital_account_code: '3110',
  capital_account_name: `${name} — Capital`,
  drawings_account_code: '3210',
  drawings_account_name: `${name} — Drawings`,
  admitted_on: '2026-01-01',
  retired_on,
});

function mount(partners: ReturnType<typeof partner>[]) {
  apiClient.mockReset();
  apiClient.mockImplementation((url: string) => {
    if (url === '/v1/partners') return Promise.resolve(partners);
    if (url === '/v1/accounting/owner-equity') return Promise.resolve([]);
    return Promise.resolve(null);
  });
  return render(<OwnerEquityPage />);
}

/**
 * The request names the owner; the server derives their account from the
 * direction (docs/25 L-23). The screen used to offer every equity account in one
 * picker, so a "capital in" could be posted to a drawings account or the plug.
 */
describe('OwnerEquityPage — the owner, not an account', () => {
  beforeEach(() => accounts.mockReturnValue([acct('1020', 'Bank Account — Main', true)]));

  it('picks the owner, and no equity account at all', async () => {
    mount([partner('Junaid'), partner('Umair')]);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Junaid' })).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Umair' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Capital|Drawings|Opening Balance Equity/ })).toBeNull();
  });

  it('says where to add owners when none are recorded', async () => {
    mount([]);
    await waitFor(() => expect(screen.getByText(/No owners recorded yet/)).toBeTruthy());
  });

  it('leaves out an owner who retired before the date', async () => {
    mount([partner('Junaid'), partner('Gone', '2020-01-01')]);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Junaid' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: 'Gone' })).toBeNull();
  });
});

describe('OwnerEquityPage — money moves through cash, as the chart defines it (L-20)', () => {
  it('offers every account flagged as cash — an owner’s second bank too — and nothing else', async () => {
    accounts.mockReturnValue([
      acct('1020', 'Bank Account — Main', true),
      acct('1045', 'Bank Account — Second', true),
      acct('1025', 'Cheques in Hand (Under Collection)', false),
    ]);
    mount([partner('Junaid')]);
    await waitFor(() => expect(screen.getByRole('option', { name: /Bank Account — Second/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Cheques in Hand/ })).toBeNull();
  });
});
