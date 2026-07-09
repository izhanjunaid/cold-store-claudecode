import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/chart-of-accounts',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

let role = 'OWNER';
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role } }),
}));

const confirmFn = vi.fn().mockResolvedValue(true);
vi.mock('@/components/form', () => ({
  useConfirm: () => confirmFn,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import ChartOfAccountsPage from './page';

const ACCOUNTS = [
  {
    id: 'a-1010',
    account_code: '1010',
    account_name: 'Cash on Hand',
    account_class: 'ASSET',
    account_type: 'DETAIL',
    parent_account_code: '1000',
    normal_balance: 'DEBIT',
    is_system_account: true,
    is_active: true,
  },
  {
    id: 'a-6000',
    account_code: '6000',
    account_name: 'Operating Expenses',
    account_class: 'EXPENSE',
    account_type: 'HEADER',
    parent_account_code: null,
    normal_balance: 'DEBIT',
    is_system_account: true,
    is_active: true,
  },
  {
    id: 'a-6090',
    account_code: '6090',
    account_name: 'Misc Expense',
    account_class: 'EXPENSE',
    account_type: 'DETAIL',
    parent_account_code: '6000',
    normal_balance: 'DEBIT',
    is_system_account: false,
    is_active: true,
  },
];

describe('ChartOfAccountsPage — owner management', () => {
  beforeEach(() => {
    apiClient.mockReset();
    confirmFn.mockClear();
    apiClient.mockResolvedValue(ACCOUNTS);
    role = 'OWNER';
  });

  it('shows Add Account to the OWNER only', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /add account/i })).toBeTruthy();
  });

  it('hides all management controls from an ACCOUNTANT', async () => {
    role = 'ACCOUNTANT';
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /add account/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /deactivate/i })).toBeNull();
  });

  it('creates a DETAIL account under a same-class header and refreshes the list', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /add account/i }));

    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: '6095' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Generator Fuel' } });
    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'EXPENSE' } });
    fireEvent.change(screen.getByLabelText(/parent/i), { target: { value: '6000' } });

    apiClient.mockClear();
    apiClient.mockResolvedValue(ACCOUNTS);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/accounting/accounts', {
        method: 'POST',
        body: {
          account_code: '6095',
          account_name: 'Generator Fuel',
          account_class: 'EXPENSE',
          account_type: 'DETAIL',
          parent_account_code: '6000',
          normal_balance: 'DEBIT',
        },
      }),
    );
    // List refetched after create.
    await waitFor(() => expect(apiClient.mock.calls.some(([url]) => String(url).startsWith('/v1/accounting/accounts?'))).toBe(true));
  });

  it('renames a non-system account via PATCH', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/new name/i), { target: { value: 'Sundry Expense' } });

    apiClient.mockClear();
    apiClient.mockResolvedValue(ACCOUNTS);
    fireEvent.click(screen.getByRole('button', { name: /save name/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/accounting/accounts/6090', {
        method: 'PATCH',
        body: { account_name: 'Sundry Expense' },
      }),
    );
  });

  it('deactivates a non-system account after confirmation', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    apiClient.mockClear();
    apiClient.mockResolvedValue(ACCOUNTS);
    fireEvent.click(screen.getByRole('button', { name: /deactivate/i }));

    await waitFor(() => expect(confirmFn).toHaveBeenCalled());
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/accounting/accounts/6090', {
        method: 'PATCH',
        body: { is_active: false },
      }),
    );
  });

  it('offers no rename/deactivate on system accounts', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    // Only the one non-system DETAIL row has actions.
    expect(screen.getAllByRole('button', { name: /rename/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /deactivate/i })).toHaveLength(1);
  });
});
