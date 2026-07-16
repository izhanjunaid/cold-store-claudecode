import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/lots/new',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role: 'OPERATOR' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import LotCreatePage from './page';

const PARTY = { id: 'party-1', name: 'Farmer One', party_type: 'FARMER' };
const COMMODITY = { id: 'commodity-1', name: 'POTATO' };
const CHAMBER = {
  id: 'chamber-1',
  name: 'Room A',
  commodity_restriction_id: null,
  max_capacity_bags: 1000,
  current_occupancy_bags: 0,
  available_capacity_bags: 1000,
};
const RATE_PLAN = { id: 'rate-1', name: 'Monthly', commodity_id: null, rate_type: 'MONTHLY_PER_BAG', rate_amount_pkr: 100 };
const FACILITY = { id: 'fac-1', name: 'Test Facility', settings: { weight_dispute_threshold_kg: 5, chamber_capacity_warning_pct: 90 } };

function routeApiClient() {
  apiClient.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.startsWith('/v1/parties')) return Promise.resolve([PARTY]);
    if (path.startsWith('/v1/commodities')) return Promise.resolve([COMMODITY]);
    if (path.startsWith('/v1/varieties')) return Promise.resolve([]);
    if (path.startsWith('/v1/chambers') && !opts?.method) return Promise.resolve([CHAMBER]);
    if (path.startsWith('/v1/rate-plans')) return Promise.resolve([RATE_PLAN]);
    if (path.startsWith('/v1/facilities/me')) return Promise.resolve(FACILITY);
    if (path === '/v1/lots' && opts?.method === 'POST') {
      return Promise.resolve({ id: 'lot-1', lot_number: 'LOT-260101-0001' });
    }
    return Promise.resolve(null);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LotCreatePage />
    </QueryClientProvider>,
  );
}

async function pickCombobox(testId: string, optionText: string) {
  fireEvent.click(await screen.findByTestId(testId));
  fireEvent.click(await screen.findByText(optionText));
}

async function fillRequiredFields() {
  await pickCombobox('combobox-owner_party_id', 'Farmer One');
  await pickCombobox('combobox-commodity_id', COMMODITY.name);
  await pickCombobox('combobox-chamber_id', CHAMBER.name);
  await pickCombobox('combobox-rate_plan_id', RATE_PLAN.name);
  fireEvent.change(screen.getByLabelText(/^Quantity/), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText(/^Accepted weight/), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText(/^Inbound date/), { target: { value: '2026-01-15' } });
}

describe('LotCreatePage — Save & New', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    routeApiClient();
  });

  it('creates the lot, does not navigate, and resets the form keeping sticky fields', async () => {
    renderPage();
    await fillRequiredFields();

    fireEvent.click(screen.getByRole('button', { name: /save & new/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/v1/lots',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            owner_party_id: 'party-1',
            commodity_id: 'commodity-1',
            chamber_id: 'chamber-1',
            rate_plan_id: 'rate-1',
            quantity_bags: 10,
            accepted_weight_kg: 200,
            inbound_date: '2026-01-15',
          }),
        }),
      ),
    );

    // Doesn't navigate away like the default submit does.
    expect(push).not.toHaveBeenCalled();

    // Sticky fields (date, room, commodity, rate plan) survive the reset.
    await waitFor(() => expect(screen.getByTestId('combobox-commodity_id')).toHaveTextContent(COMMODITY.name));
    expect(screen.getByTestId('combobox-chamber_id')).toHaveTextContent(CHAMBER.name);
    expect(screen.getByTestId('combobox-rate_plan_id')).toHaveTextContent(RATE_PLAN.name);
    expect(screen.getByLabelText(/^Inbound date/)).toHaveValue('2026-01-15');

    // Everything else clears for the next truck.
    expect(screen.getByTestId('combobox-owner_party_id')).toHaveTextContent(/select party/i);
    expect(screen.getByLabelText(/^Quantity/)).toHaveValue(null);
    expect(screen.getByLabelText(/^Accepted weight/)).toHaveValue(null);
  }, 10_000); // Radix combobox popover + 6 reference-data fetches run past the 5s default in CI.

  it(
    'default "Create Inbound Lot" submit still navigates to the lot detail page',
    async () => {
      renderPage();
      await fillRequiredFields();

      fireEvent.click(screen.getByRole('button', { name: /^create inbound lot$/i }));

      await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/lots', expect.objectContaining({ method: 'POST' })));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/lots/lot-1'));
    },
    10_000,
  );
});
