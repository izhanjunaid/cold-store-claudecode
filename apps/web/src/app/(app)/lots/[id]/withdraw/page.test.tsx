import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOT_ID = 'lot-1';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useParams: () => ({ id: LOT_ID }),
  usePathname: () => `/lots/${LOT_ID}/withdraw`,
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

let role = 'OWNER';
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions: [] } };
    return selector ? selector(state) : state;
  },
}));

// "Today" is pinned per test where it matters, so the date checks don't depend on
// when (or in which time zone) the suite runs. null = the real localIsoDate().
let today: string | null = null;
vi.mock('@coldchain/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coldchain/shared')>();
  return {
    ...actual,
    localIsoDate: (...args: Parameters<typeof actual.localIsoDate>) => today ?? actual.localIsoDate(...args),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import WithdrawPage from './page';

const OWNER_PARTY_ID = 'party-owner-1';
const BILLING_PARTY_ID = OWNER_PARTY_ID;
const LOT = {
  id: LOT_ID,
  lot_number: 'LOT-260101-0001',
  status: 'ACTIVE',
  owner_party_id: OWNER_PARTY_ID,
  owner_party_name: 'Farmer One',
  billing_party_id: BILLING_PARTY_ID,
  billing_party_name: 'Farmer One',
  commodity_name: 'POTATO',
  current_balance_bags: 40,
};
const OWNER_PARTY = { id: OWNER_PARTY_ID, name: 'Farmer One', party_type: 'FARMER', is_active: true };
const RECEIVING_PARTY = { id: 'party-2', name: 'Trader Two', party_type: 'TRADER', is_active: true };
const FACILITY = { id: 'fac-1', name: 'Test Facility', settings: { backdating_max_days: 3 } };
let billingParty = { id: BILLING_PARTY_ID, name: 'Farmer One', credit_limit_pkr: null as number | null, over_credit_limit: undefined as boolean | undefined };

function routeApiClient() {
  apiClient.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === `/v1/lots/${LOT_ID}`) return Promise.resolve(LOT);
    if (path === `/v1/parties/${BILLING_PARTY_ID}`) return Promise.resolve(billingParty);
    if (path.startsWith('/v1/parties?')) return Promise.resolve([OWNER_PARTY, RECEIVING_PARTY]);
    if (path === `/v1/lots/${LOT_ID}/placements`) return Promise.resolve(null);
    if (path === '/v1/facilities/me') return Promise.resolve(FACILITY);
    if (path === '/v1/outbound-events' && opts?.method === 'POST') {
      return Promise.resolve({ id: 'outbound-1' });
    }
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WithdrawPage />
    </QueryClientProvider>,
  );
}

async function pickReceiver(name: RegExp) {
  fireEvent.click(await screen.findByTestId('combobox-receiving_party_id'));
  fireEvent.click(await screen.findByRole('option', { name }));
}

function fillVehicle(value = 'LHR-1234') {
  fireEvent.change(screen.getByLabelText(/^Vehicle number/), { target: { value } });
}

const posted = () =>
  apiClient.mock.calls.filter(([path, opts]) => path === '/v1/outbound-events' && opts?.method === 'POST');

beforeEach(() => {
  push.mockReset();
  apiClient.mockReset();
  role = 'OWNER';
  today = null;
  billingParty = { id: BILLING_PARTY_ID, name: 'Farmer One', credit_limit_pkr: null, over_credit_limit: undefined };
  routeApiClient();
});

describe('WithdrawPage — searchable receiving party', () => {
  it('picks the receiving party via the searchable combobox and submits it', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    await pickReceiver(/Farmer One/);
    fillVehicle();

    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/v1/outbound-events',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ receiving_party_id: OWNER_PARTY_ID, vehicle_number: 'LHR-1234' }),
        }),
      ),
    );
    // The owner collecting their own goods is not a third-party release.
    expect(posted()[0]?.[1].body).not.toHaveProperty('third_party_release');
  }, 10_000);

  it('warns client-side when the outbound date exceeds the facility backdating window', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    const dateInput = screen.getByLabelText(/^Outbound date/);
    fireEvent.change(dateInput, { target: { value: '2026-01-01' } });

    await waitFor(() => expect(screen.getByText(/backdated/i)).toBeInTheDocument());
    expect(screen.getByText(/manager approval/i)).toBeInTheDocument();
  });

  it('warns (non-blocking) when the billing party is over their credit limit', async () => {
    billingParty = { id: BILLING_PARTY_ID, name: 'Farmer One', credit_limit_pkr: 5000, over_credit_limit: true };
    renderPage();
    await screen.findByText('LOT-260101-0001');

    await waitFor(() => expect(screen.getByText(/over credit limit/i)).toBeInTheDocument());
    // Non-blocking: submit is still enabled.
    expect(screen.getByRole('button', { name: /create withdrawal/i })).not.toBeDisabled();
  });

  it('shows no credit warning when the billing party is within their limit', async () => {
    billingParty = { id: BILLING_PARTY_ID, name: 'Farmer One', credit_limit_pkr: 5000, over_credit_limit: false };
    renderPage();
    await screen.findByText('LOT-260101-0001');

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith(`/v1/parties/${BILLING_PARTY_ID}`));
    expect(screen.queryByText(/over credit limit/i)).not.toBeInTheDocument();
  });
});

describe('WithdrawPage — outbound date', () => {
  it("defaults to the viewer's local today (localIsoDate), not the UTC date", async () => {
    today = '2026-03-15';
    renderPage();
    await screen.findByText('LOT-260101-0001');

    expect(screen.getByLabelText(/^Outbound date/)).toHaveValue('2026-03-15');
    expect(screen.queryByText(/future date/i)).not.toBeInTheDocument();
  });

  it('counts backdated days from calendar dates', async () => {
    today = '2026-03-15';
    renderPage();
    await screen.findByText('LOT-260101-0001');

    fireEvent.change(screen.getByLabelText(/^Outbound date/), { target: { value: '2026-03-10' } });
    expect(await screen.findByText(/Backdated 5 days/)).toBeInTheDocument();

    // Inside the 3-day window: no warning.
    fireEvent.change(screen.getByLabelText(/^Outbound date/), { target: { value: '2026-03-12' } });
    await waitFor(() => expect(screen.queryByText(/backdated/i)).not.toBeInTheDocument());
  });

  it('hints that a date after today needs a manager', async () => {
    today = '2026-03-15';
    renderPage();
    await screen.findByText('LOT-260101-0001');

    fireEvent.change(screen.getByLabelText(/^Outbound date/), { target: { value: '2026-03-16' } });
    expect(await screen.findByText('Future date — only a manager can save this.')).toBeInTheDocument();
    expect(screen.queryByText(/backdated/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Outbound date/), { target: { value: '2026-03-15' } });
    await waitFor(() => expect(screen.queryByText(/future date/i)).not.toBeInTheDocument());
  });
});

describe('WithdrawPage — vehicle number', () => {
  it('is a required field and upper-cases the plate as typed', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    const vehicle = screen.getByLabelText(/^Vehicle number/);
    expect(vehicle).toBeRequired();
    expect(vehicle).toHaveAttribute('name', 'vehicle_number');
    expect(vehicle).not.toHaveAttribute('placeholder', 'Optional');

    fireEvent.change(vehicle, { target: { value: 'lhr-1234' } });
    expect(vehicle).toHaveValue('LHR-1234');

    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/v1/outbound-events',
        expect.objectContaining({ body: expect.objectContaining({ vehicle_number: 'LHR-1234' }) }),
      ),
    );
  });

  it('refuses to submit without a plate', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    // Blank spaces get past the browser's `required` check; the form catches them.
    fillVehicle('   ');
    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));

    expect(await screen.findByText("Enter the truck's number plate")).toBeInTheDocument();
    expect(posted()).toHaveLength(0);
  });
});

describe('WithdrawPage — third-party release', () => {
  it('offers the third-party box to a manager only when the receiver is not the owner, and sends it', async () => {
    role = 'MANAGER';
    renderPage();
    await screen.findByText('LOT-260101-0001');

    const box = () => screen.queryByRole('checkbox', { name: /third-party release/i });
    expect(box()).not.toBeInTheDocument();

    await pickReceiver(/Farmer One/);
    expect(box()).not.toBeInTheDocument();

    await pickReceiver(/Trader Two/);
    expect(box()).toBeInTheDocument();
    expect(screen.queryByText(/needs a manager/i)).not.toBeInTheDocument();
    fillVehicle();

    // Unticked: blocked with a message.
    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));
    expect(await screen.findByText(/tick .*third-party release/i)).toBeInTheDocument();
    expect(posted()).toHaveLength(0);

    fireEvent.click(box()!);
    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));

    await waitFor(() => expect(posted()).toHaveLength(1));
    expect(posted()[0]?.[1].body).toEqual(
      expect.objectContaining({ receiving_party_id: 'party-2', third_party_release: true }),
    );
  }, 10_000);

  it('tells a non-manager a manager is needed and does not submit', async () => {
    role = 'OPERATOR';
    renderPage();
    await screen.findByText('LOT-260101-0001');

    await pickReceiver(/Trader Two/);
    fillVehicle();

    expect(screen.getByText('Releasing to someone other than the owner needs a manager.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /third-party release/i })).not.toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /create withdrawal/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    fireEvent.submit(submit.closest('form')!);
    await new Promise((r) => setTimeout(r, 50));
    expect(posted()).toHaveLength(0);
  }, 10_000);
});
