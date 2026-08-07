import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/accounting/expenses/new',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role: 'ACCOUNTANT' } }),
}));

vi.mock('@/lib/permissions', () => ({
  can: () => true,
  useCan: () => true,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Stub only the query hook — the real isExpenseAccount predicate still runs, so
// the class filter under test is the shipped one. Stubbing also keeps
// useAccounts' own fetch out of the apiClient call counts asserted below.
const ACCOUNTS = [
  { account_code: '5010', account_name: 'Electricity — Refrigeration', account_class: 'COST_OF_SERVICE', account_type: 'DETAIL', parent_account_code: '5000', is_active: true },
  { account_code: '6100', account_name: 'Miscellaneous', account_class: 'EXPENSE', account_type: 'DETAIL', parent_account_code: '6000', is_active: true },
  // Added through the Chart of Accounts screen after ship — must appear here.
  { account_code: '6160', account_name: 'Generator Fuel', account_class: 'EXPENSE', account_type: 'DETAIL', parent_account_code: '6000', is_active: true },
  // Not an expense — must not appear.
  { account_code: '1020', account_name: 'Bank Account — Main', account_class: 'ASSET', account_type: 'DETAIL', parent_account_code: '1000', is_active: true },
  // Posted by the payroll run and the depreciation run respectively — a manual
  // voucher against either would double-count.
  { account_code: '6010', account_name: 'Salaries — Management & Office', account_class: 'EXPENSE', account_type: 'DETAIL', parent_account_code: '6000', is_active: true },
  { account_code: '6120', account_name: 'Depreciation — Building', account_class: 'EXPENSE', account_type: 'DETAIL', parent_account_code: '6000', is_active: true },
];
vi.mock('@/hooks/use-reference-data', async (importActual) => ({
  ...(await importActual<typeof import('@/hooks/use-reference-data')>()),
  useAccounts: () => ({ data: ACCOUNTS }),
}));

import NewExpenseVoucherPage from './page';

function fillRequiredFields() {
  fireEvent.change(screen.getByPlaceholderText(/LESCO refrigeration bill/i), {
    target: { value: 'Test bill' },
  });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });
}

describe('NewExpenseVoucherPage — double-submit guard', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
  });

  it('creates exactly one voucher when Create Draft is clicked again during navigation', async () => {
    apiClient.mockResolvedValue({ id: 'voucher-1' });
    const { container } = render(<NewExpenseVoucherPage />);
    fillRequiredFields();

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    fireEvent.click(submitBtn);
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/accounting/expenses/voucher-1'));

    // Navigation to the [id] page is slow in dev; the user clicks again before it lands.
    expect(submitBtn).toBeDisabled();
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Still exactly one POST — no duplicate DRAFT vouchers.
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('re-enables Create Draft after a failed submit so the user can retry', async () => {
    apiClient.mockRejectedValueOnce(new Error('Server error'));
    const { container } = render(<NewExpenseVoucherPage />);
    fillRequiredFields();

    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;

    fireEvent.click(submitBtn);
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    expect(apiClient).toHaveBeenCalledTimes(1);

    // Retry succeeds.
    apiClient.mockResolvedValueOnce({ id: 'voucher-2' });
    fireEvent.click(submitBtn);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/accounting/expenses/voucher-2'));
    expect(apiClient).toHaveBeenCalledTimes(2);
  });
});

// The picker used to hold a literal 12-entry account list, so an account created
// in the Chart of Accounts never showed up here — a create path with no matching
// read path.
describe('NewExpenseVoucherPage — expense account picker', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
  });

  it('offers every expense/cost account from the chart, including newly added ones', () => {
    render(<NewExpenseVoucherPage />);
    const codes = Array.from(
      document.querySelectorAll<HTMLOptionElement>('select option'),
    ).map((o) => o.value);

    expect(codes).toContain('6160'); // added after ship
    expect(codes).toContain('5010');
    expect(codes).toContain('6100');
  });

  it('excludes accounts that are not expense or cost-of-service', () => {
    render(<NewExpenseVoucherPage />);
    const codes = Array.from(
      document.querySelectorAll<HTMLOptionElement>('select option'),
    ).map((o) => o.value);

    expect(codes).not.toContain('1020');
  });

  // Caught by running the app, not by a test: widening the picker to "every
  // EXPENSE/COST_OF_SERVICE account" re-exposed accounts the old hardcoded list
  // had deliberately left out, each of which is posted by an automated flow.
  it('excludes cost accounts that have their own posting flow', () => {
    render(<NewExpenseVoucherPage />);
    const codes = Array.from(
      document.querySelectorAll<HTMLOptionElement>('select option'),
    ).map((o) => o.value);

    expect(codes).not.toContain('6010'); // payroll run
    expect(codes).not.toContain('6120'); // depreciation run
  });

  it('posts the selected account code', async () => {
    apiClient.mockResolvedValue({ id: 'voucher-3' });
    const { container } = render(<NewExpenseVoucherPage />);
    fillRequiredFields();

    fireEvent.change(container.querySelector('select') as HTMLSelectElement, {
      target: { value: '6160' },
    });
    fireEvent.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
    expect(apiClient.mock.calls[0]![1].body.expense_account_code).toBe('6160');
  });
});
