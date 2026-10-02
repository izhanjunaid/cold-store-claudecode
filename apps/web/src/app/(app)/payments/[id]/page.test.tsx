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

vi.mock('@/lib/permissions', () => ({ can: () => true, useCan: () => true }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The Apply Advance panel now renders via the real EditableRows (no
// ConfirmDialogProvider dependency remains on this page — Clear/Dishonour
// are their own Dialogs, not useConfirm() — so @/components/form no longer
// needs stubbing here).

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
  is_advance: true,
  unallocated_pkr: 50000,
  can_allocate: true,
  can_clear: false,
  can_dishonour: false,
  allocations: [] as unknown[],
};

const invoices = [
  { id: 'inv-1', invoice_number: 'INV-001', balance_due_pkr: 20000 },
  { id: 'inv-2', invoice_number: 'INV-002', balance_due_pkr: 15000 },
];

const allocatedPayment = {
  ...advancePayment,
  status: 'ALLOCATED',
  unallocated_pkr: 0,
  can_allocate: false,
  allocations: [
    { id: 'a1', target: 'INVOICE', invoice_id: 'inv-1', invoice_number: 'INV-001', loan_id: null, loan_number: null, allocated_amount_pkr: 20000 },
  ],
};

function routeApiClient(payment: typeof advancePayment, after = allocatedPayment) {
  apiClient.mockImplementation((path: string) => {
    if (path === `/v1/payments/${ID}`) return Promise.resolve(payment);
    if (path === `/v1/payments/${ID}/allocate`) return Promise.resolve(after);
    return Promise.resolve(null);
  });
}

describe('PaymentDetailPage — applying a receipt', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    apiClientList.mockReset();
    apiClientList.mockResolvedValue({ data: invoices, meta: { total: 2, page: 1, per_page: 100 } });
  });

  it('does not show Apply Advance when the server says nothing is left to apply', async () => {
    routeApiClient({ ...advancePayment, status: 'ALLOCATED', can_allocate: false });
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

  // docs/25 R-13: a receipt on account is applied through the same form.
  it('offers to apply a receipt held on account', async () => {
    routeApiClient({ ...advancePayment, status: 'RECORDED', is_advance: false });
    render(<PaymentDetailPage />);
    expect(await screen.findByRole('button', { name: /apply receipt/i })).toBeInTheDocument();
  });

  // docs/25 R-36: a peshgi allocation has no invoice; the page used to crash on it.
  it('lists a peshgi allocation without crashing', async () => {
    routeApiClient({
      ...advancePayment,
      status: 'ALLOCATED',
      is_advance: false,
      can_allocate: false,
      allocations: [
        { id: 'a2', target: 'LOAN', invoice_id: null, invoice_number: null, loan_id: 'loan-1', loan_number: 'L-260801-001', allocated_amount_pkr: 5000 },
      ],
    });
    render(<PaymentDetailPage />);
    expect(await screen.findByText('Peshgi L-260801-001')).toBeInTheDocument();
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
