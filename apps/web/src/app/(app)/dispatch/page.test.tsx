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
let userLoaded = true;
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: userLoaded ? { role, permissions } : null };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

// The two sheets have their own tests; here only that the desk opens them for the right row.
vi.mock('@/components/dispatch/checkout-sheet', () => ({
  CheckoutSheet: ({
    outboundId,
    lotId,
    onDone,
  }: {
    outboundId: string;
    lotId?: string;
    onDone: (r: unknown) => void;
  }) => (
    <div data-testid="checkout" data-id={outboundId} data-lot={lotId}>
      <button type="button" onClick={() => onDone({ outbound: { id: outboundId }, invoice: {}, payment: null })}>
        finish checkout
      </button>
    </div>
  ),
}));
vi.mock('@/components/outbound/withdraw-sheet', () => ({
  WithdrawSheet: ({ lotId, plateSuggestions, fixedPlate }: { lotId: string; plateSuggestions?: string[]; fixedPlate?: string }) => (
    <div data-testid="withdraw" data-lot={lotId} data-plates={(plateSuggestions ?? []).join(',')} data-fixed={fixedPlate ?? ''} />
  ),
}));
vi.mock('@/components/dispatch/truck-checkout-sheet', () => ({
  TruckCheckoutSheet: ({ passId }: { passId: string }) => <div data-testid="truck-checkout" data-pass={passId} />,
}));
vi.mock('@/components/dispatch/dispatch-pdf', () => ({
  openDispatchNotePdf: vi.fn().mockResolvedValue(undefined),
  openLoadSlipPdf: vi.fn().mockResolvedValue(undefined),
}));
import { openDispatchNotePdf } from '@/components/dispatch/dispatch-pdf';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let trucks: any[] = [];
const truck = (over: Record<string, unknown>) => ({
  gate_pass_id: 'pass-1',
  pass_number: 'GP-261027-0001',
  vehicle_number: 'LHR-9999',
  driver_name: null,
  arrived_at: '2026-10-27T05:00:00.000Z',
  ready: false,
  lines: [],
  ...over,
});

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
  userLoaded = true;
  trucks = [];
  apiClient.mockImplementation((path: string) => Promise.resolve(path === '/v1/dispatch/trucks' ? trucks : {}));
  apiClientList.mockImplementation((path: string) => {
    if (path.startsWith('/v1/outbound-events')) return Promise.resolve({ data: ROWS, meta: { total: ROWS.length, page: 1, per_page: 50 } });

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
    expect(call).toContain('status=PENDING%2CWEIGHED%2CDISPUTED%2CDISPATCHED');
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
    const checkout = await screen.findByTestId('checkout');
    expect(checkout).toHaveAttribute('data-id', 'ob-weighed');
    // The checkout is told which lot, so it can offer "picked from which racks".
    expect(checkout).toHaveAttribute('data-lot', 'lot-1');
    unmount();

    role = 'OPERATOR';
    permissions = ['outbound.record'];
    renderPage();
    const again = (await screen.findByText('DN-WEIGHED')).closest('tr') as HTMLElement;
    expect(within(again).queryByRole('button', { name: /Dispatch & Collect/ })).not.toBeInTheDocument();
    expect(within(again).getByText(/Waiting for a manager/)).toBeInTheDocument();
  });

  it('with the owner’s solo switch on, the munshi gets the Dispatch & Collect button too', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    apiClient.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/facilities/me'
          ? { id: 'f', name: 'F', settings: { dispatch_solo_mode: true } }
          : path === '/v1/dispatch/trucks'
            ? []
            : {},
      ),
    );
    renderPage();
    const weighed = (await screen.findByText('DN-WEIGHED')).closest('tr') as HTMLElement;
    expect(await within(weighed).findByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();
    expect(within(weighed).queryByText(/Waiting for a manager/)).not.toBeInTheDocument();
  });

  it('offers Cancel only while the truck has not been dispatched', async () => {
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    expect(within(booked).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const weighed = screen.getByText('DN-WEIGHED').closest('tr') as HTMLElement;
    expect(within(weighed).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const owes = screen.getByText('DN-OWES').closest('tr') as HTMLElement;
    expect(within(owes).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('cancels a booked withdrawal with a reason and refreshes the queue', async () => {
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    fireEvent.click(within(booked).getByRole('button', { name: 'Cancel' }));
    const confirm = await screen.findByRole('button', { name: 'Cancel withdrawal' });
    expect(confirm).toBeDisabled(); // a reason is required
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Truck did not come' } });
    const queueFetches = () => apiClientList.mock.calls.filter(([p]) => String(p).startsWith('/v1/outbound-events')).length;
    const before = queueFetches();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/outbound-events/ob-booked/cancel', {
        method: 'POST',
        body: { reason: 'Truck did not come' },
      }),
    );
    await waitFor(() => expect(queueFetches()).toBeGreaterThan(before));
  });

  it('finds a lot and opens the withdrawal drawer with the trucks inside as one-tap plates', async () => {
    trucks = [truck({})];
    renderPage();
    fireEvent.change(await screen.findByLabelText('Find a lot'), { target: { value: 'LOT-7' } });
    fireEvent.click(await screen.findByRole('button', { name: /LOT-7/ }, { timeout: 5000 })); // after the 250 ms debounce
    const drawer = await screen.findByTestId('withdraw');
    expect(drawer).toHaveAttribute('data-lot', 'lot-7');
    expect(drawer).toHaveAttribute('data-plates', 'LHR-9999');
    expect(drawer).toHaveAttribute('data-fixed', '');
  });

  it('the queue refreshes at once after a checkout, even while the dispatch note is still rendering', async () => {
    // Rendering the note can take minutes (Chromium); the row must not sit on "Weighed" meanwhile.
    vi.mocked(openDispatchNotePdf).mockReturnValueOnce(new Promise(() => {}));
    renderPage();
    const weighed = (await screen.findByText('DN-WEIGHED')).closest('tr') as HTMLElement;
    fireEvent.click(within(weighed).getByRole('button', { name: /Dispatch & Collect/ }));
    await screen.findByTestId('checkout');
    const queueFetches = () => apiClientList.mock.calls.filter(([p]) => String(p).startsWith('/v1/outbound-events')).length;
    const before = queueFetches();
    fireEvent.click(screen.getByRole('button', { name: 'finish checkout' }));
    await waitFor(() => expect(queueFetches()).toBeGreaterThan(before));
    expect(openDispatchNotePdf).toHaveBeenCalledWith('ob-weighed');
  });

  it('asks the server nothing until the signed-in user is known', async () => {
    userLoaded = false;
    renderPage();
    await new Promise((r) => setTimeout(r, 50));
    expect(apiClientList).not.toHaveBeenCalled();
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('is closed to someone who cannot book withdrawals', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    renderPage();
    expect(await screen.findByText(/don.t have permission/i)).toBeInTheDocument();
    expect(apiClientList).not.toHaveBeenCalled();
  });
});

describe('Dispatch Desk — trucks with several lots', () => {
  const TWO_LINES = [
    { outbound_id: 'ob-weighed', dispatch_note_number: 'DN-WEIGHED', status: 'WEIGHED', stage: 'WEIGHED', lot_number: 'LOT-1', marka: null, billing_party: { id: 'p', name: 'Haji Sahib' }, quantity_withdrawn_bags: 40 },
    { outbound_id: 'ob-second', dispatch_note_number: 'DN-SECOND', status: 'WEIGHED', stage: 'WEIGHED', lot_number: 'LOT-2', marka: 'AH', billing_party: { id: 'p', name: 'Haji Sahib' }, quantity_withdrawn_bags: 20 },
  ];

  it('shows each truck inside with its lots, and checks a ready truck out whole', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: TWO_LINES })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).getByText(/DN-SECOND/)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'Check out truck' }));
    expect(await screen.findByTestId('truck-checkout')).toHaveAttribute('data-pass', 'pass-1');
  });

  it('a lot on a truck of several is checked out with the truck, not on its own', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: TWO_LINES })];
    renderPage();
    const weighed = (await screen.findByText('DN-WEIGHED', { selector: 'td' })).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(weighed).getByText('Check out with the truck')).toBeInTheDocument());
    expect(within(weighed).queryByRole('button', { name: /Dispatch & Collect/ })).not.toBeInTheDocument();
  });

  it('a truck with a lot still to weigh cannot be checked out yet', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: false, lines: [TWO_LINES[0], { ...TWO_LINES[1], status: 'PENDING', stage: 'BOOKED' }] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Check out truck' })).toBeDisabled();
  });

  it('"Add a lot" books the next lot onto that truck: the drawer opens with its plate fixed', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', lines: [TWO_LINES[0]] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Add a lot' }));
    fireEvent.change(screen.getByLabelText('Find a lot'), { target: { value: 'LOT-7' } });
    fireEvent.click(await screen.findByRole('button', { name: /LOT-7/ }, { timeout: 5000 }));
    expect(await screen.findByTestId('withdraw')).toHaveAttribute('data-fixed', 'LHR-2222');
  });
});
