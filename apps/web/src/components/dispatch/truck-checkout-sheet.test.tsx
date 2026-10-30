import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { localIsoDate } from '@coldchain/shared';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: (...a: unknown[]) => apiClient(...a) };
});
import { ApiError } from '@/lib/api-client';

let permissions: string[] = ['outbound.record', 'outbound.finalize', 'invoices.manage', 'payments.record'];
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role: 'MANAGER', permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { TruckCheckoutSheet } from './truck-checkout-sheet';

// The first test also pays for the sheet's module warm-up: 4.2 s of the default 5 s on a loaded box.
vi.setConfig({ testTimeout: 15_000 });

const bill = (id: string, party: { id: string; name: string }, storage: number, service = 0) => ({
  outbound_id: id,
  dispatch_note_number: `DN-${id}`,
  lot_number: `LOT-${id}`,
  billing_party: party,
  book_type: 'PACCI',
  quantity_withdrawn_bags: 10,
  outbound_weight_kg: 195,
  period_start: '2026-04-10',
  period_end: '2026-10-27',
  storage_line: { description: 'Seasonal storage', quantity: 10, unit_price_pkr: storage / 10, amount_pkr: storage, days: 200 },
  service_lines: service ? [{ service_charge_id: `svc-${id}`, description: 'Loading', quantity: 10, unit_price_pkr: service / 10, amount_pkr: service }] : [],
  sub_total_pkr: storage + service,
  gst_rate: 0,
  gst_amount_pkr: 0,
  total_pkr: storage + service,
});
const A = { id: 'pa', name: 'Haji Sahib' };
const B = { id: 'pb', name: 'Bashir' };

let preview: any;
const posts = () => apiClient.mock.calls.filter(([, o]) => o?.method === 'POST');

function renderSheet(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TruckCheckoutSheet open onOpenChange={vi.fn()} passId="pass-1" onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  apiClient.mockReset();
  permissions = ['outbound.record', 'outbound.finalize', 'invoices.manage', 'payments.record'];
  preview = {
    gate_pass_id: 'pass-1',
    pass_number: 'GP-1',
    vehicle_number: 'LHR-2222',
    lines: [bill('1', A, 1000, 60), bill('2', A, 500), bill('3', B, 300)],
    not_ready: [],
    groups: [
      { billing_party: A, book_type: 'PACCI', outbound_ids: ['1', '2'], total_pkr: 1560, credit_available: false },
      { billing_party: B, book_type: 'PACCI', outbound_ids: ['3'], total_pkr: 300, credit_available: true },
    ],
    total_pkr: 1860,
    solo: { allowed: true },
  };
  apiClient.mockImplementation((path: string, opts?: { method?: string }) =>
    Promise.resolve(
      opts?.method === 'POST'
        ? { gate_pass_id: 'pass-1', lines: [], payments: [{ id: 'r1', receipt_number: 'RCP-1', billing_party_id: 'pa', book_type: 'PACCI', amount_pkr: 1560 }] }
        : preview,
    ),
  );
});

describe('TruckCheckoutSheet', () => {
  it('one payment row per paying party, and the request carries every line at its reviewed total', async () => {
    const onDone = renderSheet();
    const groupB = (await screen.findByText('Bashir', { selector: '[data-group-party]' })).closest('[data-group]') as HTMLElement;
    fireEvent.click(within(groupB).getByRole('button', { name: 'On credit' }));
    fireEvent.click(screen.getByRole('button', { name: /Check out truck/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe('/v1/dispatch/trucks/pass-1/dispatch-and-collect');
    expect(posts()[0]![1].body).toEqual({
      lines: [
        { outbound_id: '1', expected_total_pkr: 1060 },
        { outbound_id: '2', expected_total_pkr: 500 },
        { outbound_id: '3', expected_total_pkr: 300 },
      ],
      payments: [
        { billing_party_id: 'pa', book_type: 'PACCI', mode: 'CASH' },
        { billing_party_id: 'pb', book_type: 'PACCI', mode: 'CREDIT' },
      ],
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('a manager may leave a charge off one bill: that line is sent without it, at its new total', async () => {
    renderSheet();
    fireEvent.click(await screen.findByLabelText(/Loading/));
    expect(screen.getByRole('button', { name: /Check out truck/ })).toHaveTextContent('1,800');
    fireEvent.click(screen.getByRole('button', { name: /Check out truck/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body.lines[0]).toEqual({ outbound_id: '1', expected_total_pkr: 1000, skip_service_charge_ids: ['svc-1'] });
  });

  it('the munshi alone: no charge can be left off, and credit only where the party\'s approval covers it', async () => {
    permissions = ['outbound.record'];
    renderSheet();
    expect(await screen.findByLabelText(/Loading/)).toBeDisabled();
    const groupA = screen.getByText('Haji Sahib', { selector: '[data-group-party]' }).closest('[data-group]') as HTMLElement;
    const groupB = screen.getByText('Bashir', { selector: '[data-group-party]' }).closest('[data-group]') as HTMLElement;
    expect(within(groupA).getByRole('button', { name: 'On credit' })).toBeDisabled();
    expect(within(groupA).getByRole('button', { name: 'Cheque' })).toBeDisabled();
    expect(within(groupB).getByRole('button', { name: 'On credit' })).toBeEnabled();
  });

  it('a truck held by a lot marked disputed cannot be checked out, and says which (never "weigh")', async () => {
    preview = { ...preview, not_ready: ['DN-9'] };
    renderSheet();
    const held = await screen.findByText(/DN-9/);
    expect(held.textContent).not.toMatch(/weigh/i);
    expect(screen.getByRole('button', { name: /Check out truck/ })).toBeDisabled();
  });

  // Weight is optional (docs/27); a charge priced per ton is the one thing that needs a weight.
  it('a per-ton charge with no weight blocks the truck until a manager leaves it off', async () => {
    const perTon = { service_charge_id: 'svc-ton', description: 'Weighbridge', quantity: 0, unit_price_pkr: 500, amount_pkr: 0, needs_weight: true };
    preview = { ...preview, lines: [{ ...bill('1', A, 1000, 60), service_lines: [perTon] }, bill('2', A, 500), bill('3', B, 300)] };
    renderSheet();
    const notice = await screen.findByText(/charged per ton/);
    expect(notice).toHaveTextContent('DN-1');
    expect(notice).toHaveTextContent('Weighbridge');
    expect(screen.getByRole('button', { name: /Check out truck/ })).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/Weighbridge/));
    expect(screen.queryByText(/charged per ton/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Check out truck/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body.lines[0]).toEqual({ outbound_id: '1', expected_total_pkr: 1000, skip_service_charge_ids: ['svc-ton'] });
  });

  it("a line dated before today is marked: it may be an earlier visit's booking", async () => {
    const today = localIsoDate();
    preview = {
      ...preview,
      lines: [
        { ...bill('1', A, 1000, 60), period_end: today },
        { ...bill('2', A, 500), period_end: '2026-01-05' },
        { ...bill('3', B, 300), period_end: today },
      ],
    };
    renderSheet();
    await screen.findByText('Bashir', { selector: '[data-group-party]' });
    const marked = screen.getAllByText(/dated/i);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest('[data-line]')).toHaveTextContent('DN-2');
  });

  it('when the truck changed meanwhile it shows why and prices it again', async () => {
    apiClient.mockImplementation((path: string, opts?: { method?: string }) =>
      opts?.method === 'POST'
        ? Promise.reject(new ApiError('The truck\'s load changed since it was reviewed — review it again', { code: 'TRUCK_LOAD_CHANGED', status: 409 }))
        : Promise.resolve(preview),
    );
    renderSheet();
    await screen.findByText('Bashir', { selector: '[data-group-party]' }); // priced: the button is live
    fireEvent.click(screen.getByRole('button', { name: /Check out truck/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/load changed/);
    await waitFor(() => expect(apiClient.mock.calls.filter(([p, o]) => String(p).endsWith('/checkout-preview') && !o).length).toBeGreaterThan(1));
  });
});
