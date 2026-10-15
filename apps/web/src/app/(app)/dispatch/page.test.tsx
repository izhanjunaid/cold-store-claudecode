import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/dispatch',
}));

const apiClient = vi.fn();
const apiClientList = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiClient: (...args: unknown[]) => apiClient(...args),
    apiClientList: (...args: unknown[]) => apiClientList(...args),
  };
});

let role = 'MANAGER';
let permissions: string[] = ['outbound.record', 'outbound.finalize', 'invoices.manage', 'payments.record'];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

// The two sheets have their own tests; here only that the desk opens them for the right row.
vi.mock('@/components/dispatch/checkout-sheet', () => ({
  CheckoutSheet: ({ outboundId }: { outboundId: string }) => <div data-testid="checkout" data-id={outboundId} />,
}));
vi.mock('@/components/outbound/withdraw-sheet', () => ({
  WithdrawSheet: ({ lotId, plateSuggestions }: { lotId: string; plateSuggestions?: string[] }) => (
    <div data-testid="withdraw" data-lot={lotId} data-plates={(plateSuggestions ?? []).join(',')} />
  ),
}));
vi.mock('@/components/dispatch/dispatch-pdf', () => ({ openDispatchNotePdf: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/billing/invoice-pdf', () => ({ openInvoicePdf: vi.fn().mockResolvedValue(undefined) }));

import DispatchDeskPage from './page';

const row = (over: Record<string, unknown>) => ({
  id: 'ob',
  dispatch_note_number: 'DN-1',
  status: 'PENDING',
  stage: 'BOOKED',
  lot_id: 'lot-1',
  lot_number: 'LOT-1',
  marka: null,
  owner_party_name: 'Haji Sahib',
  quantity_withdrawn_bags: 40,
  vehicle_number: 'LHR-1111',
  invoice: null,
  ...over,
});

const ROWS = [
  row({ id: 'ob-booked', dispatch_note_number: 'DN-BOOKED', stage: 'BOOKED' }),
  row({ id: 'ob-weighed', dispatch_note_number: 'DN-WEIGHED', status: 'WEIGHED', stage: 'WEIGHED', vehicle_number: 'LHR-2222' }),
  row({
    id: 'ob-owes',
    dispatch_note_number: 'DN-OWES',
    status: 'DISPATCHED',
    stage: 'DISPATCHED',
    vehicle_number: 'LHR-3333',
    invoice: { id: 'inv-1', invoice_number: 'INV-1', status: 'FINALIZED', total_pkr: 5000, balance_due_pkr: 5000 },
  }),
  row({ id: 'ob-left', dispatch_note_number: 'DN-LEFT', status: 'DISPATCHED', stage: 'LEFT', vehicle_number: 'LHR-4444' }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DispatchDeskPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  push.mockReset();
  apiClient.mockReset();
  apiClientList.mockReset();
  role = 'MANAGER';
  permissions = ['outbound.record', 'outbound.finalize', 'invoices.manage', 'payments.record'];
  apiClient.mockResolvedValue({});
  apiClientList.mockImplementation((path: string) => {
    if (path.startsWith('/v1/outbound-events')) return Promise.resolve({ data: ROWS, meta: { total: ROWS.length, page: 1, per_page: 50 } });
    if (path.startsWith('/v1/gate-passes')) return Promise.resolve({ data: [{ vehicle_number: 'LHR-9999' }, { vehicle_number: 'LHR-9999' }], meta: {} });
    if (path.startsWith('/v1/lots')) {
      return Promise.resolve({
        data: [{ id: 'lot-7', lot_number: 'LOT-7', owner_party_name: 'Bashir', marka: 'BF', commodity_name: 'POTATO', current_balance_bags: 120, status: 'ACTIVE' }],
        meta: {},
      });
    }
    return Promise.resolve({ data: [], meta: {} });
  });
});

describe('Dispatch Desk', () => {
  it('offers each row its next step, and leaves out trucks that already left', async () => {
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    expect(within(booked).getByRole('button', { name: 'Weigh' })).toBeInTheDocument();

    const weighed = screen.getByText('DN-WEIGHED').closest('tr') as HTMLElement;
    expect(within(weighed).getByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();

    const owes = screen.getByText('DN-OWES').closest('tr') as HTMLElement;
    expect(within(owes).getByRole('button', { name: 'Print DN' })).toBeInTheDocument();
    expect(within(owes).getByText(/owes/)).toBeInTheDocument();

    expect(screen.queryByText('DN-LEFT')).not.toBeInTheDocument();
  });

  it('asks the queue for open withdrawals from the last two days only', async () => {
    renderPage();
    await screen.findByText('DN-BOOKED');
    const call = apiClientList.mock.calls.map(([p]) => String(p)).find((p) => p.startsWith('/v1/outbound-events'))!;
    expect(call).toContain('status=PENDING%2CWEIGHED%2CDISPATCHED');
    expect(call).toMatch(/date_from=\d{4}-\d{2}-\d{2}/);
  });

  it('weighs a booked withdrawal inline', async () => {
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    fireEvent.change(within(booked).getByLabelText(/Weight in kg/), { target: { value: '1950' } });
    fireEvent.click(within(booked).getByRole('button', { name: 'Weigh' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/outbound-events/ob-booked/weight', { method: 'PATCH', body: { outbound_weight_kg: 1950 } }),
    );
  });

  it('a manager opens the checkout for a weighed truck; the munshi is told to wait for one', async () => {
    const { unmount } = renderPage();
    const weighed = (await screen.findByText('DN-WEIGHED')).closest('tr') as HTMLElement;
    fireEvent.click(within(weighed).getByRole('button', { name: /Dispatch & Collect/ }));
    expect(await screen.findByTestId('checkout')).toHaveAttribute('data-id', 'ob-weighed');
    unmount();

    role = 'OPERATOR';
    permissions = ['outbound.record'];
    renderPage();
    const again = (await screen.findByText('DN-WEIGHED')).closest('tr') as HTMLElement;
    expect(within(again).queryByRole('button', { name: /Dispatch & Collect/ })).not.toBeInTheDocument();
    expect(within(again).getByText(/Waiting for a manager/)).toBeInTheDocument();
  });

  it('finds a lot and opens the withdrawal drawer with the trucks inside as one-tap plates', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Find a lot'), { target: { value: 'LOT-7' } });
    fireEvent.click(await screen.findByRole('button', { name: /LOT-7/ }));
    const drawer = await screen.findByTestId('withdraw');
    expect(drawer).toHaveAttribute('data-lot', 'lot-7');
    // The same plate logged twice is offered once.
    expect(drawer).toHaveAttribute('data-plates', 'LHR-9999');
  });

  it('is closed to someone who cannot book withdrawals', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    renderPage();
    expect(await screen.findByText(/don.t have permission/i)).toBeInTheDocument();
    expect(apiClientList).not.toHaveBeenCalled();
  });
});
