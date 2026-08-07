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
let permissions: string[] = [];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so useCan's `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
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
    permissions = [];
  });

  it('shows Add Account to a user with accounting.manage_accounts', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /add account/i })).toBeTruthy();
  });

  it('shows management to a non-owner who was granted the permission', async () => {
    role = 'MANAGER';
    permissions = ['accounting.manage_accounts'];
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /add account/i })).toBeTruthy();
  });

  it('hides all management controls from a user without the permission', async () => {
    role = 'ACCOUNTANT';
    permissions = [];
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

    // Fields are filled in dependency order: class decides the parents, the
    // parent decides the code block.
    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'EXPENSE' } });
    fireEvent.change(screen.getByLabelText(/parent/i), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Generator Fuel' } });
    // Override the suggestion — the field stays editable on purpose.
    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: '6095' } });

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

  it('prefills the account code from the chosen parent, and clears it when the class changes', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));

    const code = screen.getByLabelText(/account code/i) as HTMLInputElement;
    expect(code.value).toBe('');

    // 6000's highest child is 6090, so the next round slot in its block is 6100.
    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'EXPENSE' } });
    fireEvent.change(screen.getByLabelText(/parent/i), { target: { value: '6000' } });
    expect(code.value).toBe('6100');

    // Changing class invalidates the parent, so the code it produced must go too
    // rather than linger under a heading it no longer belongs to.
    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'ASSET' } });
    expect(code.value).toBe('');
  });

  it('rejects a code from another class range before it reaches the server', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));

    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'EXPENSE' } });
    fireEvent.change(screen.getByLabelText(/parent/i), { target: { value: '6000' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Generator Fuel' } });
    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: '1999' } });

    expect(screen.getByText(/belong to another class/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /create account/i })).toHaveProperty('disabled', true);
  });

  it('flags a duplicate code without a round trip', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /add account/i }));

    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: '1010' } });
    expect(screen.getByText(/already in use/i)).toBeTruthy();
  });

  // Filtering the table used to leave the dialog on ASSET with an empty parent
  // list, disabling the submit button with nothing on screen explaining why.
  it('opens Add account on the filtered class with its headers available', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    fireEvent.change(screen.getByDisplayValue(/all classes/i), { target: { value: 'EXPENSE' } });
    await waitFor(() =>
      expect(apiClient.mock.calls.some(([u]) => String(u).includes('account_class=EXPENSE'))).toBe(true),
    );

    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    expect((screen.getByLabelText(/class/i) as HTMLSelectElement).value).toBe('EXPENSE');
    expect(screen.getByRole('option', { name: /6000 — Operating Expenses/ })).toBeTruthy();
  });

  it('filters the table by code or name', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/search accounts/i), { target: { value: 'cash' } });
    expect(screen.getByText(/Cash on Hand/)).toBeTruthy();
    expect(screen.queryByText(/Misc Expense/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/search accounts/i), { target: { value: '6090' } });
    expect(screen.getByText(/Misc Expense/)).toBeTruthy();
    expect(screen.queryByText(/Cash on Hand/)).toBeNull();
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

  it('requires a parent before a non-equity account can be created', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Misc Expense/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /add account/i }));
    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: '6096' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Watchman Chai' } });
    fireEvent.change(screen.getByLabelText(/class/i), { target: { value: 'EXPENSE' } });

    // No parent chosen yet — non-equity accounts must sit under a header.
    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/parent/i), { target: { value: '6000' } });
    expect(screen.getByRole('button', { name: /create account/i })).not.toBeDisabled();
  });

  it('offers no rename/deactivate on system accounts', async () => {
    render(<ChartOfAccountsPage />);
    await waitFor(() => expect(screen.getByText(/Cash on Hand/)).toBeTruthy());
    // Only the one non-system DETAIL row has actions.
    expect(screen.getAllByRole('button', { name: /rename/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /deactivate/i })).toHaveLength(1);
  });
});
