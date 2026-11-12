import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { localIsoDate } from '@coldchain/shared';

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
    onDone: (r: unknown, tab?: unknown) => void;
  }) => (
    <div data-testid="checkout" data-id={outboundId} data-lot={lotId}>
      <button type="button" onClick={() => onDone({ outbound: { id: outboundId }, invoice: {}, payment: null }, { noteTab: true })}>
        finish checkout
      </button>
    </div>
  ),
}));
vi.mock('@/components/outbound/withdraw-sheet', () => ({
  WithdrawSheet: ({ lotId, plateSuggestions, fixedPlate }: { lotId: string; plateSuggestions?: string[]; fixedPlate?: string }) => (
    <div data-testid="withdraw" data-lot={lotId} data-plates={(plateSuggestions ?? []).join(',')} data-plates-known={plateSuggestions === undefined ? 'no' : 'yes'} data-fixed={fixedPlate ?? ''} />
  ),
}));
vi.mock('@/components/dispatch/truck-checkout-sheet', () => ({
  TruckCheckoutSheet: ({ passId, onDone }: { passId: string; onDone: (r: unknown, tab?: unknown) => void }) => (
    <div data-testid="truck-checkout" data-pass={passId}>
      <button type="button" onClick={() => onDone({ gate_pass_id: passId, lines: [], payments: [] }, { slipTab: true })}>
        finish truck checkout
      </button>
    </div>
  ),
}));
vi.mock('@/components/dispatch/dispatch-pdf', () => ({
  openDispatchNotePdf: vi.fn().mockResolvedValue(undefined),
  openLoadSlipPdf: vi.fn().mockResolvedValue(undefined),
}));
import { openDispatchNotePdf, openLoadSlipPdf } from '@/components/dispatch/dispatch-pdf';
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

// The managers' waiting list (docs/28 D6): empty unless a test fills it.
let waitingRows: any[] = [];
const waitingRow = (over: Record<string, unknown>) => ({
  id: 'w-1',
  dispatch_note_number: 'DN-W1',
  lot_id: 'lot-w1',
  lot_number: 'LOT-W1',
  marka: null,
  owner_party_name: 'Rana Traders',
  quantity_withdrawn_bags: 12,
  vehicle_number: 'LHR-5555',
  outbound_date: localIsoDate(),
  created_at: '2026-11-08T04:00:00.000Z',
  created_by_name: 'Munshi',
  reason_code: 'SOLO_OFF',
  ask_code: null,
  asked_at: null,
  ...over,
});
const waitingCalls = () => apiClientList.mock.calls.filter(([p]) => String(p).startsWith('/v1/dispatch/waiting')).length;

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
  waitingRows = [];
  apiClient.mockImplementation((path: string) => Promise.resolve(path === '/v1/dispatch/trucks' ? trucks : {}));
  apiClientList.mockImplementation((path: string) => {
    if (path.startsWith('/v1/outbound-events')) return Promise.resolve({ data: ROWS, meta: { total: ROWS.length, page: 1, per_page: 50 } });
    if (path.startsWith('/v1/dispatch/waiting')) {
      return Promise.resolve({ data: waitingRows, meta: { total: waitingRows.length, page: 1, per_page: 200 } });
    }

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
    // Weight is optional (docs/27): a booked row checks out straight away; weighing is on offer.
    expect(within(booked).getByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();
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

  it('with weights hidden a booked row has no weight box, only its checkout', async () => {
    apiClient.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/v1/facilities/me' ? { id: 'f', name: 'F', settings: { hide_weights: true } } : path === '/v1/dispatch/trucks' ? [] : {},
      ),
    );
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(booked).queryByLabelText(/Weight in kg/)).not.toBeInTheDocument());
    expect(within(booked).queryByRole('button', { name: 'Weigh' })).not.toBeInTheDocument();
    expect(within(booked).getByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();
  });

  it('a row marked disputed (a status nothing sets any more) is never offered a checkout', async () => {
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/v1/outbound-events')
          ? { data: [row({ id: 'ob-disputed', dispatch_note_number: 'DN-DISPUTED', status: 'DISPUTED', stage: 'BOOKED' })], meta: {} }
          : { data: [], meta: {} },
      ),
    );
    renderPage();
    const disputed = (await screen.findByText('DN-DISPUTED')).closest('tr') as HTMLElement;
    expect(within(disputed).queryByRole('button', { name: /Dispatch & Collect/ })).not.toBeInTheDocument();
    expect(within(disputed).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
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
    // The munshi calls a manager instead (docs/28 O6).
    expect(within(again).getByRole('button', { name: 'Call a manager' })).toBeInTheDocument();
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
    expect(within(weighed).queryByRole('button', { name: 'Call a manager' })).not.toBeInTheDocument();
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

  it('does not hand the form a list of trucks it has not read: a failed fetch is "unknown", not "none inside"', async () => {
    // Else the form reads an empty list as "no truck is inside" and, with the switch on, locks a munshi out.
    apiClient.mockImplementation((path: string) =>
      path === '/v1/dispatch/trucks' ? Promise.reject(new Error('offline')) : Promise.resolve({}),
    );
    renderPage();
    fireEvent.change(await screen.findByLabelText('Find a lot'), { target: { value: 'LOT-7' } });
    fireEvent.click(await screen.findByRole('button', { name: /LOT-7/ }, { timeout: 5000 }));
    expect(await screen.findByTestId('withdraw')).toHaveAttribute('data-plates-known', 'no');
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
    // The tab the sheet opened on the click is the one that is filled (docs/28 D8).
    expect(openDispatchNotePdf).toHaveBeenCalledWith('ob-weighed', { noteTab: true });
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

  it("a truck's checkout fills the load slip tab the sheet opened on the click", async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: TWO_LINES })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Check out truck' }));
    fireEvent.click(await screen.findByRole('button', { name: 'finish truck checkout' }));
    await waitFor(() => expect(openLoadSlipPdf).toHaveBeenCalledWith('pass-1', { slipTab: true }));
  });

  it('a lot on a truck of several is checked out with the truck, not on its own', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: TWO_LINES })];
    renderPage();
    const weighed = (await screen.findByText('DN-WEIGHED', { selector: 'td' })).closest('tr') as HTMLElement;
    await waitFor(() => expect(within(weighed).getByText('Check out with the truck')).toBeInTheDocument());
    expect(within(weighed).queryByRole('button', { name: /Dispatch & Collect/ })).not.toBeInTheDocument();
  });

  it('a booked lot never holds its truck: weight is optional (docs/27)', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: [TWO_LINES[0], { ...TWO_LINES[1], status: 'PENDING', stage: 'BOOKED' }] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Check out truck' })).toBeEnabled();
    expect(within(card).queryByText(/first/)).not.toBeInTheDocument();
  });

  it("a lot dated before today is marked on the truck card: it may be an earlier visit's booking", async () => {
    trucks = [
      truck({
        vehicle_number: 'LHR-2222',
        ready: true,
        lines: [
          { ...TWO_LINES[0], outbound_date: localIsoDate() },
          { ...TWO_LINES[1], status: 'PENDING', stage: 'BOOKED', outbound_date: '2026-01-05' },
        ],
      }),
    ];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    const marked = within(card).getAllByText(/dated/i);
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest('li')).toHaveTextContent('DN-SECOND');
  });

  it('a truck held by a lot marked disputed cannot be checked out yet', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: false, lines: [TWO_LINES[0], { ...TWO_LINES[1], status: 'DISPUTED', stage: 'BOOKED' }] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).getByRole('button', { name: 'Check out truck' })).toBeDisabled();
  });

  it('a truck held by a disputed lot says which, and each lot on the card opens its withdrawal', async () => {
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: false, lines: [TWO_LINES[0], { ...TWO_LINES[1], status: 'DISPUTED', stage: 'BOOKED' }] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).getByText(/Cancel DN-SECOND first/).textContent).not.toMatch(/weigh/i);
    fireEvent.click(within(card).getByRole('button', { name: 'DN-SECOND' }));
    expect(push).toHaveBeenCalledWith('/outbound-events/ob-second');
  });

  it('a truck carrying more lots than one checkout takes: each keeps its own Dispatch & Collect', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...TWO_LINES[1], outbound_id: `ob-m${i}`, dispatch_note_number: `DN-M${i}` }));
    trucks = [truck({ vehicle_number: 'LHR-2222', ready: true, lines: [TWO_LINES[0], ...many] })];
    renderPage();
    const card = (await screen.findByText('LHR-2222', { selector: '[data-truck-plate]' })).closest('[data-truck]') as HTMLElement;
    expect(within(card).queryByRole('button', { name: 'Check out truck' })).not.toBeInTheDocument();
    expect(within(card).getByText(/one by one/)).toBeInTheDocument();
    const weighed = screen.getByText('DN-WEIGHED', { selector: 'td' }).closest('tr') as HTMLElement;
    expect(within(weighed).getByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();
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

describe('Dispatch Desk — the munshi calls a manager (docs/28 O6)', () => {
  it("a munshi's ready row has Call a manager, and shows when it was called", async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/v1/outbound-events')
          ? {
              data: [
                row({ id: 'ob-booked', dispatch_note_number: 'DN-BOOKED' }),
                row({ id: 'ob-called', dispatch_note_number: 'DN-CALLED', ask_code: 'CALLED', asked_at: '2026-11-08T09:05:00.000Z' }),
              ],
              meta: { total: 2, page: 1, per_page: 50 },
            }
          : { data: [], meta: {} },
      ),
    );
    renderPage();
    const booked = (await screen.findByText('DN-BOOKED')).closest('tr') as HTMLElement;
    fireEvent.click(within(booked).getByRole('button', { name: 'Call a manager' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/dispatch/ask-manager', {
        method: 'POST',
        body: { outbound_ids: ['ob-booked'], ask_code: 'CALLED' },
      }),
    );
    const called = screen.getByText('DN-CALLED').closest('tr') as HTMLElement;
    expect(within(called).getByRole('button', { name: /^Called / })).toBeInTheDocument();
  });

  it('a call from an earlier day names its day on the desk row', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/v1/outbound-events')
          ? {
              data: [row({ id: 'ob-old-call', dispatch_note_number: 'DN-OLDCALL', ask_code: 'CALLED', asked_at: '2026-09-02T09:05:00.000Z' })],
              meta: { total: 1, page: 1, per_page: 50 },
            }
          : { data: [], meta: {} },
      ),
    );
    renderPage();
    const old = (await screen.findByText('DN-OLDCALL')).closest('tr') as HTMLElement;
    expect(within(old).getByRole('button', { name: /^Called 2 Sep\w* 2026/ })).toBeInTheDocument();
  });
});

describe('Dispatch Desk — a call, seen by a munshi who can finish the row', () => {
  it('shows when a manager was called, beside Dispatch & Collect', async () => {
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
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/v1/outbound-events')
          ? {
              data: [row({ id: 'ob-asked', dispatch_note_number: 'DN-ASKED', ask_code: 'CREDIT', asked_at: '2026-09-02T09:05:00.000Z' })],
              meta: { total: 1, page: 1, per_page: 50 },
            }
          : { data: [], meta: {} },
      ),
    );
    renderPage();
    const asked = (await screen.findByText('DN-ASKED')).closest('tr') as HTMLElement;
    expect(await within(asked).findByRole('button', { name: /Dispatch & Collect/ })).toBeInTheDocument();
    expect(within(asked).getByText(/^Called 2 Sep\w* 2026/)).toBeInTheDocument();
  });
});

describe('Dispatch Desk — waiting for a manager (docs/28 D6)', () => {
  const card = () => screen.findByRole('region', { name: 'Waiting for a manager' });

  it("a manager sees the waiting card with each row's reason, called rows first", async () => {
    waitingRows = [
      waitingRow({
        id: 'w-call',
        dispatch_note_number: 'DN-CALL',
        reason_code: null,
        ask_code: 'CHEQUE_OR_TRANSFER',
        asked_at: '2026-11-08T09:05:00.000Z',
      }),
      waitingRow({ id: 'w-solo', dispatch_note_number: 'DN-SOLO' }),
    ];
    renderPage();
    const c = await card();
    expect(within(c).getByText('Waiting for a manager (2)')).toBeInTheDocument();
    const items = within(c).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('DN-CALL');
    expect(items[0]).toHaveTextContent(/Called .*the buyer pays by cheque or transfer/);
    expect(items[1]).toHaveTextContent('DN-SOLO');
    expect(items[1]).toHaveTextContent('the owner has not switched on one-person dispatch');
  });

  it('the card is hidden for a munshi, and the waiting list is never requested', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    waitingRows = [waitingRow({})];
    renderPage();
    await screen.findByText('DN-BOOKED');
    expect(screen.queryByRole('region', { name: 'Waiting for a manager' })).toBeNull();
    expect(waitingCalls()).toBe(0);
  });

  it("a row from before the desk's three days opens the checkout with its lot", async () => {
    waitingRows = [waitingRow({ id: 'w-old', dispatch_note_number: 'DN-OLD', lot_id: 'lot-old', outbound_date: '2026-09-01' })];
    renderPage();
    fireEvent.click(within(await card()).getByRole('button', { name: /Dispatch & Collect/ }));
    const sheet = await screen.findByTestId('checkout');
    expect(sheet).toHaveAttribute('data-id', 'w-old');
    expect(sheet).toHaveAttribute('data-lot', 'lot-old');
  });

  it('a line on a multi-lot truck inside opens the truck checkout', async () => {
    trucks = [
      truck({
        gate_pass_id: 'pass-7',
        vehicle_number: 'LHR 5555',
        ready: true,
        lines: [
          { outbound_id: 'w-1', dispatch_note_number: 'DN-W1', status: 'PENDING', stage: 'BOOKED', lot_number: 'LOT-W1', marka: null, billing_party: { id: 'p', name: 'Rana' }, quantity_withdrawn_bags: 12 },
          { outbound_id: 'w-2', dispatch_note_number: 'DN-W2', status: 'PENDING', stage: 'BOOKED', lot_number: 'LOT-W2', marka: null, billing_party: { id: 'p', name: 'Rana' }, quantity_withdrawn_bags: 8 },
        ],
      }),
    ];
    waitingRows = [waitingRow({ vehicle_number: 'LHR-5555' })];
    renderPage();
    const c = await card();
    await waitFor(() => expect(within(c).getByRole('button', { name: 'Check out truck' })).toBeInTheDocument());
    fireEvent.click(within(c).getByRole('button', { name: 'Check out truck' }));
    expect(await screen.findByTestId('truck-checkout')).toHaveAttribute('data-pass', 'pass-7');
  });

  it('"Check out truck" on the card is off while the truck is not ready, as on the truck panel', async () => {
    trucks = [
      truck({
        gate_pass_id: 'pass-8',
        vehicle_number: 'LHR 5555',
        ready: false,
        lines: [
          { outbound_id: 'w-1', dispatch_note_number: 'DN-W1', status: 'PENDING', stage: 'BOOKED', lot_number: 'LOT-W1', marka: null, billing_party: { id: 'p', name: 'Rana' }, quantity_withdrawn_bags: 12 },
          { outbound_id: 'w-2', dispatch_note_number: 'DN-W2', status: 'DISPUTED', stage: 'BOOKED', lot_number: 'LOT-W2', marka: null, billing_party: { id: 'p', name: 'Rana' }, quantity_withdrawn_bags: 8 },
        ],
      }),
    ];
    waitingRows = [waitingRow({ vehicle_number: 'LHR-5555' })];
    renderPage();
    const c = await card();
    await waitFor(() => expect(within(c).getByRole('button', { name: 'Check out truck' })).toBeInTheDocument());
    expect(within(c).getByRole('button', { name: 'Check out truck' })).toBeDisabled();
  });

  it('old bookings sit under "Booked before today" with a Cancel button', async () => {
    waitingRows = [
      waitingRow({ id: 'w-today', dispatch_note_number: 'DN-TODAY' }),
      waitingRow({ id: 'w-old', dispatch_note_number: 'DN-OLD', outbound_date: '2026-09-01' }),
    ];
    renderPage();
    const c = await card();
    const old = within(c).getByRole('group', { name: 'Booked before today' });
    expect(within(old).getByText('DN-OLD')).toBeInTheDocument();
    expect(within(old).queryByText('DN-TODAY')).toBeNull();
    expect(within(old).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const today = within(c).getByText('DN-TODAY').closest('li') as HTMLElement;
    expect(within(today).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('a called booking from an earlier day still shows its date and a Cancel button, and which day it was called', async () => {
    waitingRows = [
      waitingRow({
        id: 'w-stale',
        dispatch_note_number: 'DN-STALE',
        outbound_date: '2026-09-01',
        reason_code: null,
        ask_code: 'CHEQUE_OR_TRANSFER',
        asked_at: '2026-09-02T09:05:00.000Z',
      }),
      waitingRow({
        id: 'w-fresh',
        dispatch_note_number: 'DN-FRESH',
        reason_code: null,
        ask_code: 'CREDIT',
        asked_at: new Date().toISOString(),
      }),
    ];
    renderPage();
    const c = await card();
    // Called rows keep their place at the top, not in the "Booked before today" group.
    expect(within(c).queryByRole('group', { name: 'Booked before today' })).toBeNull();
    const stale = within(c).getByText('DN-STALE').closest('li') as HTMLElement;
    expect(stale).toHaveTextContent(/booked for 1 Sep\w* 2026/);
    expect(stale).toHaveTextContent(/Called 2 Sep\w* 2026/);
    expect(within(stale).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    // A call made today reads as a time, and a booking dated today cannot be cancelled from here.
    const fresh = within(c).getByText('DN-FRESH').closest('li') as HTMLElement;
    expect(fresh).not.toHaveTextContent(/booked for/);
    expect(fresh).not.toHaveTextContent(/Called \d{1,2} \w{3} \d{4}/);
    expect(within(fresh).queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('after a checkout the waiting list is read again', async () => {
    waitingRows = [waitingRow({})];
    renderPage();
    fireEvent.click(within(await card()).getByRole('button', { name: /Dispatch & Collect/ }));
    const before = waitingCalls();
    fireEvent.click(await screen.findByRole('button', { name: 'finish checkout' }));
    await waitFor(() => expect(waitingCalls()).toBeGreaterThan(before));
  });
});
