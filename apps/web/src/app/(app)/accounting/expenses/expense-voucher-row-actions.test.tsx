import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role: 'OWNER' } }),
}));

const canMock = vi.fn();
vi.mock('@/lib/permissions', () => ({ can: (...args: unknown[]) => canMock(...args) }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const confirmMock = vi.fn();
vi.mock('@/components/form', () => ({ useConfirm: () => confirmMock }));

import { ExpenseVoucherRowActions } from './expense-voucher-row-actions';

function permissions({ approve = false, record = false }: { approve?: boolean; record?: boolean }) {
  canMock.mockImplementation((_user: unknown, key: string) =>
    key === 'expenses.approve' ? approve : key === 'expenses.record' ? record : false);
}

const DRAFT = { id: 'v-1', status: 'DRAFT' as const, is_accrual: false };
const APPROVED_ACCRUAL = { id: 'v-1', status: 'APPROVED' as const, is_accrual: true };

describe('ExpenseVoucherRowActions', () => {
  beforeEach(() => {
    apiClient.mockReset().mockResolvedValue({});
    canMock.mockReset();
    confirmMock.mockReset().mockResolvedValue(true);
  });

  it('renders nothing when the user has neither expenses permission', () => {
    permissions({});
    const { container } = render(
      <ExpenseVoucherRowActions voucher={DRAFT} onEdit={vi.fn()} onPay={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('DRAFT + record permission shows Edit, which calls onEdit without a network request', () => {
    permissions({ record: true });
    const onEdit = vi.fn();
    render(<ExpenseVoucherRowActions voucher={DRAFT} onEdit={onEdit} onPay={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('DRAFT + approve permission fires the approve POST and reports onChanged', async () => {
    permissions({ approve: true });
    const onChanged = vi.fn();
    render(<ExpenseVoucherRowActions voucher={DRAFT} onEdit={vi.fn()} onPay={vi.fn()} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/expense-vouchers/v-1/approve', { method: 'POST', body: {} }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('APPROVED accrual voucher shows Accrue and Pay, not Edit', () => {
    permissions({ record: true });
    render(
      <ExpenseVoucherRowActions voucher={APPROVED_ACCRUAL} onEdit={vi.fn()} onPay={vi.fn()} onChanged={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Accrue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('Cancel waits for confirm before firing the cancel POST', async () => {
    permissions({ approve: true });
    confirmMock.mockResolvedValue(false);
    render(<ExpenseVoucherRowActions voucher={DRAFT} onEdit={vi.fn()} onPay={vi.fn()} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiClient).not.toHaveBeenCalledWith(expect.stringContaining('/cancel'), expect.anything());
  });

  it('does not let an action click bubble to a parent row handler', () => {
    permissions({ record: true });
    const rowClick = vi.fn();
    render(
      <div onClick={rowClick}>
        <ExpenseVoucherRowActions voucher={DRAFT} onEdit={vi.fn()} onPay={vi.fn()} onChanged={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(rowClick).not.toHaveBeenCalled();
  });
});
