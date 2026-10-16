import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const OB = 'ob-1';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});
import { ApiError } from '@/lib/api-client';

let role = 'MANAGER';
let permissions: string[] = ['outbound.finalize', 'invoices.manage', 'payments.record'];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { CheckoutSheet } from './checkout-sheet';

const PREVIEW = {
  outbound_id: OB,
  dispatch_note_number: 'DN-260101-0001',
  lot_number: 'LOT-260101-0001',
  billing_party: { id: 'p1', name: 'Haji Sahib' },
  book_type: 'PACCI',
  quantity_withdrawn_bags: 100,
  outbound_weight_kg: 1950,
  period_start: '2026-04-10',
  period_end: '2026-09-01',
  storage_line: { description: 'Storage (Seasonal) — 100 bags × Rs.50', quantity: 100, unit_price_pkr: 50, amount_pkr: 5000, days: 144 },
  service_lines: [
    { service_charge_id: 'sc1', description: 'Loading', quantity: 100, unit_price_pkr: 2, amount_pkr: 200 },
  ],
  sub_total_pkr: 5200,
  gst_rate: 0,
  gst_amount_pkr: 0,
  total_pkr: 5200,
};

const RESULT = {
  outbound: { id: OB, dispatch_note_number: 'DN-260101-0001' },
  invoice: { id: 'inv-1', invoice_number: 'INV-202609-0001', total_pkr: 5200 },
  payment: { id: 'pay-1', receipt_number: 'RCP-202609-0001' },
};

function renderSheet(onDone = vi.fn(), onOpenChange = vi.fn(), lotId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CheckoutSheet open onOpenChange={onOpenChange} outboundId={OB} lotId={lotId} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onDone, onOpenChange };
}

let placements: { rack_id: string; rack_name: string; bags: number }[] = [];

const posts = () => apiClient.mock.calls.filter(([, opts]) => opts?.method === 'POST');

beforeEach(() => {
  apiClient.mockReset();
  role = 'MANAGER';
  permissions = ['outbound.finalize', 'invoices.manage', 'payments.record'];
  placements = [];
  apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST') return Promise.resolve(RESULT);
    if (path.endsWith('/checkout-preview')) return Promise.resolve(PREVIEW);
    if (path.endsWith('/placements')) {
      return Promise.resolve({ lot_id: 'lot-1', chamber_id: 'c1', chamber_name: 'Room 1', current_balance_bags: 300, placements, unplaced_bags: 0 });
    }
    return Promise.resolve(null);
  });
});

describe('CheckoutSheet', () => {
  it('shows the bill as priced and a button that names the amount', async () => {
    renderSheet();
    expect(await screen.findByText(/Storage \(Seasonal\)/)).toBeInTheDocument();
    expect(screen.getByText('Loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dispatch & Collect Rs\s?5,200/ })).toBeEnabled();
  });

  it('sends the total it showed, cash by default, and hands the result back', async () => {
    const { onDone, onOpenChange } = renderSheet();
    await screen.findByText(/Storage \(Seasonal\)/); // the bill has loaded, so the button is live
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Collect/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe(`/v1/outbound-events/${OB}/dispatch-and-collect`);
    expect(posts()[0]![1].body).toEqual({ expected_total_pkr: 5200, payment: { mode: 'CASH' } });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(RESULT));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaving a pre-added charge off changes the total it sends, and says which one was left off', async () => {
    renderSheet();
    fireEvent.click(await screen.findByLabelText(/Loading/));
    const button = await screen.findByRole('button', { name: /Dispatch & Collect Rs\s?5,000/ });
    fireEvent.click(button);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body).toEqual({
      expected_total_pkr: 5000,
      skip_service_charge_ids: ['sc1'],
      payment: { mode: 'CASH' },
    });
  });

  it('on credit it collects nothing', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'On credit' }));
    fireEvent.click(screen.getByRole('button', { name: /Dispatch on credit/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body.payment).toEqual({ mode: 'CREDIT' });
  });

  it('a cheque needs its date, a transfer its reference, before the button works', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Cheque' }));
    const go = screen.getByRole('button', { name: /Dispatch & Collect/ });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Cheque date/), { target: { value: '2026-09-10' } });
    expect(go).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bank transfer' }));
    expect(screen.getByRole('button', { name: /Dispatch & Collect/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Transfer reference/), { target: { value: 'HBL-1' } });
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Collect/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body.payment).toEqual({ mode: 'BANK_TRANSFER', reference_number: 'HBL-1' });
  });

  it('when the bill changed meanwhile, shows the refusal and prices the bill again', async () => {
    apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') {
        return Promise.reject(new ApiError('The bill is now Rs 5,400.00, not the Rs 5,200.00 shown', { code: 'DISPATCH_TOTAL_CHANGED', status: 409 }));
      }
      return Promise.resolve(PREVIEW);
    });
    renderSheet();
    await screen.findByText(/Storage \(Seasonal\)/);
    fireEvent.click(screen.getByRole('button', { name: /Dispatch & Collect/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/The bill is now Rs 5,400/);
    const priced = () => apiClient.mock.calls.filter(([p]) => String(p).endsWith('/checkout-preview')).length;
    await waitFor(() => expect(priced()).toBeGreaterThanOrEqual(2));
  });

  describe('picked from which racks', () => {
    beforeEach(() => {
      placements = [
        { rack_id: 'r1', rack_name: 'Rack A', bags: 250 },
        { rack_id: 'r2', rack_name: 'Rack B', bags: 50 },
      ];
    });

    it('sends the racks the bags came off, and only those', async () => {
      renderSheet(vi.fn(), vi.fn(), 'lot-1');
      fireEvent.change(await screen.findByLabelText('Bags picked from Rack A'), { target: { value: '60' } });
      fireEvent.change(screen.getByLabelText('Bags picked from Rack B'), { target: { value: '40' } });
      fireEvent.click(screen.getByRole('button', { name: /Dispatch & Collect/ }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]![1].body.picked_from).toEqual([
        { rack_id: 'r1', bags: 60 },
        { rack_id: 'r2', bags: 40 },
      ]);
    });

    it('left blank, sends no picks at all (the server trims the fullest racks)', async () => {
      renderSheet(vi.fn(), vi.fn(), 'lot-1');
      await screen.findByLabelText('Bags picked from Rack A');
      fireEvent.click(await screen.findByRole('button', { name: /Dispatch & Collect/ }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(posts()[0]![1].body).not.toHaveProperty('picked_from');
    });

    it('more bags picked than withdrawn is refused before anything is sent', async () => {
      renderSheet(vi.fn(), vi.fn(), 'lot-1');
      fireEvent.change(await screen.findByLabelText('Bags picked from Rack A'), { target: { value: '101' } });
      expect(await screen.findByRole('alert')).toHaveTextContent(/exceed the withdrawn quantity \(100\)/);
      expect(screen.getByRole('button', { name: /Dispatch & Collect/ })).toBeDisabled();
    });

    it('a lot with no rack placements shows no rack section', async () => {
      placements = [];
      renderSheet(vi.fn(), vi.fn(), 'lot-1');
      await screen.findByText(/Storage \(Seasonal\)/);
      expect(screen.queryByText(/Picked from/)).not.toBeInTheDocument();
    });
  });

  it('without the manager keys it cannot dispatch, and says why', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    renderSheet();
    expect(await screen.findByText(/needs a manager/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dispatch/ })).toBeDisabled();
  });

  it('without payments.record it can still go on credit, and cash is not offered', async () => {
    permissions = ['outbound.finalize', 'invoices.manage'];
    renderSheet();
    expect(await screen.findByRole('button', { name: 'Cash' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Dispatch on credit/ })).toBeEnabled();
  });
});
