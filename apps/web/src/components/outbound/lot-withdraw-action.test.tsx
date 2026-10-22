import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}));

let role = 'OPERATOR';
let permissions: string[] = ['outbound.record'];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));

// The form has its own tests (lots/[id]/withdraw/page.test.tsx); here only the wiring matters.
vi.mock('./withdraw-form', () => ({
  WithdrawForm: ({
    lotId,
    variant,
    onCreated,
    onCancel,
  }: {
    lotId: string;
    variant: string;
    onCreated: (id: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="withdraw-form" data-lot-id={lotId} data-variant={variant}>
      <button onClick={() => onCreated('ob-1')}>stub-create</button>
      <button onClick={onCancel}>stub-cancel</button>
    </div>
  ),
}));

import { LotWithdrawAction } from './lot-withdraw-action';

const LOT = { id: 'lot-1', lot_number: 'LOT-260101-0001', status: 'ACTIVE', current_balance_bags: 40 };

function renderInRow(lot = LOT) {
  const rowClick = vi.fn();
  render(
    <table>
      <tbody>
        <tr onClick={rowClick}>
          <td>
            <LotWithdrawAction lot={lot} />
          </td>
        </tr>
      </tbody>
    </table>,
  );
  return rowClick;
}

beforeEach(() => {
  push.mockReset();
  role = 'OPERATOR';
  permissions = ['outbound.record'];
});

describe('LotWithdrawAction', () => {
  it('offers Withdraw on an active lot with bags left, to someone who can book withdrawals', () => {
    renderInRow();
    expect(screen.getByRole('button', { name: /withdraw/i })).toBeInTheDocument();
  });

  it('is hidden without outbound.record', () => {
    permissions = ['lots.manage'];
    renderInRow();
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });

  it('is hidden for a closed lot and for one with no bags left', () => {
    const { unmount } = render(<LotWithdrawAction lot={{ ...LOT, status: 'CLOSED' }} />);
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
    unmount();
    render(<LotWithdrawAction lot={{ ...LOT, current_balance_bags: 0 }} />);
    expect(screen.queryByRole('button', { name: /withdraw/i })).toBeNull();
  });

  it('opens the drawer for this lot without triggering the row click', async () => {
    const rowClick = renderInRow();
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }));

    expect(await screen.findByText('New Withdrawal — LOT-260101-0001')).toBeInTheDocument();
    const form = screen.getByTestId('withdraw-form');
    expect(form).toHaveAttribute('data-lot-id', 'lot-1');
    expect(form).toHaveAttribute('data-variant', 'sheet');
    expect(rowClick).not.toHaveBeenCalled();

    // Clicks inside the drawer bubble through the React portal to the row too.
    fireEvent.click(screen.getByText('stub-cancel'));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it('closes on cancel without navigating', async () => {
    renderInRow();
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    fireEvent.click(await screen.findByText('stub-cancel'));

    await waitFor(() => expect(screen.queryByTestId('withdraw-form')).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });

  it('after booking, closes the drawer and goes to the new withdrawal', async () => {
    renderInRow();
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    fireEvent.click(await screen.findByText('stub-create'));

    expect(push).toHaveBeenCalledWith('/outbound-events/ob-1');
    await waitFor(() => expect(screen.queryByTestId('withdraw-form')).toBeNull());
  });
});
