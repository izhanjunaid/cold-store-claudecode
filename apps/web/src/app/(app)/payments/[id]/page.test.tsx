import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const ID = 'pay-1';
const PARTY = 'party-1';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useParams: () => ({ id: ID }),
  usePathname: () => `/payments/${ID}`,
}));

const apiClient = vi.fn();
const apiClientList = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
  apiClientList: (...args: unknown[]) => apiClientList(...args),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role: 'ACCOUNTANT' } }),
}));

vi.mock('@/lib/rbac', () => ({ hasMinRole: () => true }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/components/form', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

import PaymentDetailPage from './page';

const advancePayment = {
  id: ID,
  party_id: PARTY,
  party_name: 'Aslam',
  payment_date: '2026-06-20',
  amount_pkr: 50000,
  payment_method: 'CASH',
  reference_number: null,
  status: 'ADVANCE',
  clearance_status: 'NA',
  cheque_date: null,
  book_type: 'PACCI',
  notes: null,
  created_by_name: 'Acc',
  allocations: [],
};

const invoices = [
  { id: 'inv-1', invoice_number: 'INV-001', balance_due_pkr: 20000 },
  { id: 'inv-2', invoice_number: 'INV-002', balance_due_pkr: 15000 },
];

const allocatedPayment = {
  ...advancePayment,
  status: 'ALLOCATED',
  allocations: [
    { id: 'a1', invoice_id: 'inv-1', invoice_number: 'INV-001', allocated_amount_pkr: 20000 },
  ],
};

function routeApiClient(payment: typeof advancePayment, after = allocatedPayment) {
  apiClient.mockImplementation((path: string) => {
    if (path === `/v1/payments/${ID}`) return Promise.resolve(payment);
    if (path === `/v1/payments/${ID}/allocate`) return Promise.resolve(after);
    return Promise.resolve(null);
  });
}

describe('PaymentDetailPage — Apply Advance', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    apiClientList.mockReset();
    apiClientList.mockResolvedValue({ data: invoices, meta: { total: 2, page: 1, per_page: 100 } });
  });

  it('does not show Apply Advance when status is not ADVANCE', async () => {
    routeApiClient({ ...advancePayment, status: 'ALLOCATED' });
    render(<PaymentDetailPage />);
    await waitFor(() => expect(screen.getByText('Payment Detail')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /apply advance/i })).not.toBeInTheDocument();
  });

  it('shows empty state when the party has no finalized invoices with balance', async () => {
    routeApiClient(advancePayment);
    apiClientList.mockResolvedValue({ data: [], meta: { total: 0, page: 1, per_page: 100 } });
    render(<PaymentDetailPage />);
    await waitFor(() =>
      expect(screen.getByText(/no finalized invoices with outstanding balance/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /apply advance/i })).not.toBeInTheDocument();
  });

  it('applies the advance to a selected invoice with one allocate call', async () => {
    routeApiClient(advancePayment);
    render(<PaymentDetailPage />);

    const applyBtn = await screen.findByRole('button', { name: /apply advance/i });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inv-1' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20000' } });
    fireEvent.click(applyBtn);

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/v1/payments/${ID}/allocate`, {
        method: 'POST',
        body: { allocations: [{ invoice_id: 'inv-1', allocated_amount_pkr: 20000 }] },
      }),
    );
    // Panel disappears once the payment is no longer an advance.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /apply advance/i })).not.toBeInTheDocument(),
    );
  });

  it('does not fire a second allocate call on rapid double-click', async () => {
    routeApiClient(advancePayment);
    render(<PaymentDetailPage />);

    const applyBtn = await screen.findByRole('button', { name: /apply advance/i });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'inv-1' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20000' } });
    fireEvent.click(applyBtn);
    fireEvent.click(applyBtn);

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/v1/payments/${ID}/allocate`, expect.anything()));
    const allocateCalls = apiClient.mock.calls.filter((c) => c[0] === `/v1/payments/${ID}/allocate`);
    expect(allocateCalls).toHaveLength(1);
  });
});
