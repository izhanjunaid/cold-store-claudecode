import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const EVENT_ID = 'ob-1';
const LOT_ID = 'lot-1';
const INVOICE_ID = 'inv-1';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useParams: () => ({ id: EVENT_ID }),
  usePathname: () => `/outbound-events/${EVENT_ID}`,
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

let role = 'OPERATOR';
let permissions: string[] = [];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so useCan's `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));

const confirmFn = vi.fn().mockResolvedValue(true);
vi.mock('@/components/form', () => ({
  useConfirm: () => confirmFn,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { toast } from 'sonner';

import OutboundEventDetailPage from './page';

type EventStatus = 'PENDING' | 'WEIGHED' | 'DISPATCHED' | 'CANCELLED' | 'DISPUTED';

function makeEvent(over: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    lot_id: LOT_ID,
    lot_number: 'LOT-260101-0001',
    withdrawal_type: 'PARTIAL',
    quantity_withdrawn_bags: 20,
    outbound_weight_kg: 1000,
    outbound_date: '2026-10-10',
    receiving_party_name: 'Trader Two',
    vehicle_number: 'LES-1234',
    dispatch_note_number: null,
    status: 'WEIGHED' as EventStatus,
    notes: null,
    prorated_inbound_weight_kg: 1010,
    weight_variance_pct: -0.99,
    created_by_name: 'Munshi',
    invoice_id: null,
    finalized_at: null,
    voided_at: null,
    void_reason: null,
    ...over,
  };
}

let event = makeEvent();

function routeApiClient() {
  apiClient.mockImplementation((path: string, opts?: { method?: string; body?: { reason?: string } }) => {
    if (path === `/v1/outbound-events/${EVENT_ID}`) return Promise.resolve(event);
    if (path === `/v1/lots/${LOT_ID}/placements`) return Promise.resolve(null);
    if (path === `/v1/outbound-events/${EVENT_ID}/cancel` && opts?.method === 'POST') {
      return Promise.resolve(
        makeEvent({
          status: 'CANCELLED',
          voided_at: '2026-10-12T09:00:00.000Z',
          void_reason: opts.body?.reason ?? null,
        }),
      );
    }
    if (path === `/v1/outbound-events/${EVENT_ID}/finalize` && opts?.method === 'POST') {
      return Promise.resolve(
        makeEvent({
          status: 'DISPATCHED',
          dispatch_note_number: 'DN-260101-0001',
          invoice_id: INVOICE_ID,
          finalized_at: '2026-10-12T09:00:00.000Z',
        }),
      );
    }
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OutboundEventDetailPage />
    </QueryClientProvider>,
  );
}

async function loaded() {
  await screen.findByText('LOT-260101-0001');
}

describe('OutboundEventDetailPage — the gate guard counts blind', () => {
  it('shows a dash, and does not crash, when the API sends the bag counts as null', async () => {
    push.mockReset();
    apiClient.mockReset();
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    event = makeEvent({ quantity_withdrawn_bags: null });
    apiClient.mockImplementation((path: string) => {
      if (path === `/v1/outbound-events/${EVENT_ID}`) return Promise.resolve(event);
      if (path === `/v1/lots/${LOT_ID}/placements`) {
        return Promise.resolve({
          lot_id: LOT_ID,
          chamber_id: 'c1',
          chamber_name: 'Room 1',
          current_balance_bags: null,
          placements: [{ rack_id: 'r1', rack_name: 'R-1', bags: null }],
          unplaced_bags: null,
        });
      }
      return Promise.resolve(null);
    });
    renderPage();
    await loaded();
    const bags = screen.getByText('Bags Withdrawn').nextElementSibling as HTMLElement;
    expect(bags).toHaveTextContent('—');
    expect(await screen.findByText(/R-1/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

// weight_variance_pct is (inbound − outbound) / inbound: positive means the produce lost weight.
describe('OutboundEventDetailPage — the weight variance says which way it went', () => {
  const setup = (pct: number) => {
    push.mockReset();
    apiClient.mockReset();
    role = 'MANAGER';
    permissions = [];
    event = makeEvent({ weight_variance_pct: pct });
    apiClient.mockImplementation((path: string) => Promise.resolve(path === `/v1/outbound-events/${EVENT_ID}` ? event : null));
  };

  it('a positive variance is weight lost in storage', async () => {
    setup(2.5);
    renderPage();
    await loaded();
    expect(screen.getByText('2.50% lighter')).toBeInTheDocument();
  });

  it('a negative variance is weight gained', async () => {
    setup(-0.99);
    renderPage();
    await loaded();
    expect(screen.getByText('0.99% heavier')).toBeInTheDocument();
  });
});

describe('OutboundEventDetailPage — finalize gate', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    confirmFn.mockClear();
    vi.mocked(toast.success).mockClear();
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    event = makeEvent();
    routeApiClient();
  });

  it('hides Finalize & Dispatch without outbound.finalize and says a manager must dispatch', async () => {
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /finalize & dispatch/i })).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for a manager to dispatch.')).toBeInTheDocument();
  });

  it('shows Finalize & Dispatch with outbound.finalize', async () => {
    role = 'MANAGER';
    permissions = ['outbound.record', 'outbound.finalize'];
    renderPage();
    await loaded();

    expect(screen.getByRole('button', { name: /finalize & dispatch/i })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for a manager to dispatch.')).not.toBeInTheDocument();
  });

  it('shows View invoice straight after finalize, from the returned event', async () => {
    role = 'MANAGER';
    permissions = ['outbound.record', 'outbound.finalize', 'billing.view'];
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /view invoice/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /finalize & dispatch/i }));

    const viewInvoice = await screen.findByRole('button', { name: /view invoice/i });
    expect(confirmFn).toHaveBeenCalled();
    fireEvent.click(viewInvoice);
    expect(push).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}`);
  });
});

describe('OutboundEventDetailPage — invoice link', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    role = 'ACCOUNTANT';
    permissions = ['billing.view'];
    event = makeEvent({ status: 'DISPATCHED', dispatch_note_number: 'DN-260101-0001', invoice_id: INVOICE_ID });
    routeApiClient();
  });

  it('shows View invoice with billing.view when the withdrawal has an invoice', async () => {
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /view invoice/i }));
    expect(push).toHaveBeenCalledWith(`/invoices/${INVOICE_ID}`);
  });

  it('hides View invoice without billing.view', async () => {
    permissions = ['outbound.record'];
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /view invoice/i })).not.toBeInTheDocument();
  });

  it('offers no cancel once dispatched', async () => {
    permissions = ['outbound.record', 'billing.view'];
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /cancel withdrawal/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print dispatch note/i })).toBeInTheDocument();
  });
});

describe('OutboundEventDetailPage — cancel withdrawal', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    vi.mocked(toast.success).mockClear();
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    event = makeEvent();
    routeApiClient();
  });

  it('posts the reason and the page shows CANCELLED with the reason', async () => {
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /cancel withdrawal/i }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: /cancel withdrawal/i });

    // Reason is required — at least 3 characters.
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'ab' } });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: '  Truck did not come  ' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/v1/outbound-events/${EVENT_ID}/cancel`, {
        method: 'POST',
        body: { reason: 'Truck did not come' },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/cancelled.*truck did not come/i);
    expect(toast.success).toHaveBeenCalledWith('Withdrawal cancelled — its bags are free again.');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /print dispatch note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel withdrawal/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting for a manager to dispatch.')).not.toBeInTheDocument();
  });

  it('shows the API error inside the dialog and keeps it open', async () => {
    apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === `/v1/outbound-events/${EVENT_ID}`) return Promise.resolve(event);
      if (path.endsWith('/cancel') && opts?.method === 'POST') {
        return Promise.reject(new Error('This withdrawal has already been dispatched'));
      }
      return Promise.resolve(null);
    });
    renderPage();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /cancel withdrawal/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: 'Party changed mind' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /cancel withdrawal/i }));

    expect(await within(dialog).findByText('This withdrawal has already been dispatched')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each<EventStatus>(['PENDING', 'WEIGHED', 'DISPUTED'])('offers cancel while %s', async (status) => {
    event = makeEvent({ status, outbound_weight_kg: status === 'PENDING' ? null : 1000 });
    renderPage();
    await loaded();

    expect(screen.getByRole('button', { name: /cancel withdrawal/i })).toBeInTheDocument();
  });

  it('hides cancel without outbound.record', async () => {
    role = 'ACCOUNTANT';
    permissions = ['billing.view'];
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /cancel withdrawal/i })).not.toBeInTheDocument();
  });

  it('without outbound.record offers no weight entry and no dispatch note (both routes need it)', async () => {
    role = 'ACCOUNTANT';
    permissions = ['billing.view'];
    event = makeEvent({ status: 'PENDING', outbound_weight_kg: null });
    renderPage();
    await loaded();

    expect(screen.queryByRole('button', { name: /record weight/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /print dispatch note/i })).not.toBeInTheDocument();
  });

  it('with outbound.record a pending withdrawal can be weighed and its note printed', async () => {
    event = makeEvent({ status: 'PENDING', outbound_weight_kg: null });
    renderPage();
    await loaded();

    expect(screen.getByRole('button', { name: /record weight/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /print dispatch note/i })).toBeInTheDocument();
  });
});

// Weight is optional (docs/27).
describe('OutboundEventDetailPage — weight optional', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    event = makeEvent({ status: 'PENDING', outbound_weight_kg: null, prorated_inbound_weight_kg: null, weight_variance_pct: null });
    routeApiClient();
  });

  it('a manager can finalize a booked withdrawal, picks and all', async () => {
    role = 'MANAGER';
    permissions = ['outbound.record', 'outbound.finalize'];
    renderPage();
    await loaded();
    expect(screen.getByRole('button', { name: /finalize & dispatch/i })).toBeInTheDocument();
    expect(screen.queryByText('Waiting for a manager to dispatch.')).not.toBeInTheDocument();
  });

  it('the munshi is told a booked withdrawal waits for a manager', async () => {
    renderPage();
    await loaded();
    expect(screen.getByText('Waiting for a manager to dispatch.')).toBeInTheDocument();
  });

  it('a dispatched withdrawal with no weight shows a dash, not an empty card', async () => {
    event = makeEvent({ status: 'DISPATCHED', outbound_weight_kg: null, prorated_inbound_weight_kg: null, weight_variance_pct: null });
    renderPage();
    await loaded();
    expect(screen.getByText('Outbound Weight').parentElement).toHaveTextContent('—');
  });

  it('the weight is optional: no required star', async () => {
    renderPage();
    await loaded();
    expect(screen.getByText(/Outbound Weight \(kg\)/).textContent).not.toContain('*');
  });

  it('no weight card while weights are hidden', async () => {
    const route = apiClient.getMockImplementation()!;
    apiClient.mockImplementation((path: string, opts?: { method?: string }) =>
      path === '/v1/facilities/me' ? Promise.resolve({ id: 'f', settings: { hide_weights: true } }) : route(path, opts),
    );
    renderPage();
    await loaded();
    await waitFor(() => expect(screen.queryByRole('button', { name: /record weight/i })).not.toBeInTheDocument());
    expect(screen.queryByText('Weight')).not.toBeInTheDocument(); // the card's title
  });
});

describe('OutboundEventDetailPage — cancelled withdrawal', () => {
  beforeEach(() => {
    apiClient.mockReset();
    role = 'OWNER';
    permissions = [];
    event = makeEvent({
      status: 'CANCELLED',
      outbound_weight_kg: null,
      prorated_inbound_weight_kg: null,
      weight_variance_pct: null,
      voided_at: '2026-10-11T09:00:00.000Z',
      void_reason: 'Wrong lot picked',
    });
    routeApiClient();
  });

  it('shows the reason and hides print, weight, finalize and cancel', async () => {
    renderPage();
    await loaded();

    expect(screen.getByRole('status')).toHaveTextContent(/cancelled.*wrong lot picked/i);
    expect(screen.queryByRole('button', { name: /print dispatch note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record weight/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /finalize & dispatch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel withdrawal/i })).not.toBeInTheDocument();
  });
});
