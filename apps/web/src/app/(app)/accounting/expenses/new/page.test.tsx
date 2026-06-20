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

vi.mock('@/lib/rbac', () => ({
  hasMinRole: () => true,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
