import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/billing/rate-plans',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
  ApiError: class ApiError extends Error {},
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role: 'OWNER', permissions: [] } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/form', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RatePlanListPage from './page';

const POTATO = { id: 'commodity-1', name: 'Potato' };
const TARIFF_PLAN = {
  id: 'plan-1',
  name: 'Apple tariff',
  commodity_id: POTATO.id,
  commodity_name: POTATO.name,
  rate_type: 'TARIFF_PER_BAG',
  rate_amount_pkr: 30,
  season_start_date: null,
  season_end_date: null,
  min_billing_days: 1,
  tariff: {
    day_rate: null,
    month_counting: 'DAYS_30',
    opening: { type: 'BLOCK', days: 15, months_charged: 0.5 },
    remainder: { grace_days: 0, mode: 'DAILY', half_month_days: 15 },
  },
  is_active: true,
};

let plans: unknown[] = [];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RatePlanListPage />
    </QueryClientProvider>,
  );
}

const rateInput = () => screen.getByText(/Monthly rate per bag/).parentElement!.querySelector('input') as HTMLInputElement;
const dateInputs = () => Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
const dateUnder = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('input') as HTMLInputElement;

async function openNewTariffPlan() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /new rate plan/i }));
  fireEvent.change(await screen.findByDisplayValue('Seasonal / Bag'), { target: { value: 'TARIFF_PER_BAG' } });
  fireEvent.change(screen.getByPlaceholderText(/Potato Seasonal 2026/), { target: { value: 'Apple tariff' } });
  fireEvent.change(rateInput(), { target: { value: '30' } });
}

const choosePreset = (id: string) =>
  fireEvent.change(screen.getByDisplayValue(/Choose one, then change/), { target: { value: id } });

describe('RatePlanListPage — custom tariff', () => {
  beforeEach(() => {
    apiClient.mockReset();
    plans = [];
    apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith('/v1/commodities')) return Promise.resolve([POTATO]);
      if (path.startsWith('/v1/rate-plans') && !opts?.method) return Promise.resolve(plans);
      return Promise.resolve({});
    });
  });

  it('the Apple preset plus Try it shows ½ month + 1 month + 5 days, and Create sends the rule', async () => {
    await openNewTariffPlan();
    choosePreset('apple');

    const [from, to] = dateInputs();
    fireEvent.change(from!, { target: { value: '2026-01-01' } });
    fireEvent.change(to!, { target: { value: '2026-02-20' } });
    const result = await screen.findByText(/½ month.*1 month.*5 days/);
    expect(result.textContent).toMatch(/50 day/);
    // formatMoney already carries the "Rs" — the box once printed "Rs Rs 50".
    const total = screen.getByText(/per bag × 100 bags/).textContent!;
    expect(total).toMatch(/^Rs 50(\.00)? per bag × 100 bags = Rs 5,000(\.00)?$/);
    expect(total).not.toMatch(/Rs Rs/);

    fireEvent.click(screen.getByRole('button', { name: /create rate plan/i }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/rate-plans', expect.objectContaining({ method: 'POST' })));
    const body = apiClient.mock.calls.find((c) => c[1]?.method === 'POST')![1].body;
    expect(body).toMatchObject({
      name: 'Apple tariff',
      rate_type: 'TARIFF_PER_BAG',
      rate_amount_pkr: 30,
      min_billing_days: 1,
      tariff: { opening: { type: 'BLOCK', days: 15, months_charged: 0.5 }, month_counting: 'DAYS_30' },
    });
    expect(body).not.toHaveProperty('season_start_date');
    expect(body).not.toHaveProperty('season_end_date');
  });

  it('the calendar preset locks month counting and bills a split month', async () => {
    await openNewTariffPlan();
    choosePreset('calendar-split');
    expect(screen.getByDisplayValue('real calendar months')).toBeDisabled();

    const [from, to] = dateInputs();
    fireEvent.change(from!, { target: { value: '2026-09-20' } });
    fireEvent.change(to!, { target: { value: '2026-11-09' } });
    expect((await screen.findByText(/per bag × 100 bags/)).textContent).toMatch(/Rs 53(\.00)? per bag/);
  });

  it('a season fee without a season end is refused in words and blocks Create until one is set', async () => {
    await openNewTariffPlan();
    choosePreset('season-extension');

    expect(screen.getByRole('alert').textContent).toMatch(/season end date/i);
    expect(screen.getByRole('button', { name: /create rate plan/i })).toBeDisabled();

    fireEvent.change(dateUnder(/^Season End/), { target: { value: '2026-03-31' } });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('button', { name: /create rate plan/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /create rate plan/i }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/rate-plans', expect.objectContaining({ method: 'POST' })));
    const body = apiClient.mock.calls.find((c) => c[1]?.method === 'POST')![1].body;
    expect(body).toMatchObject({ season_end_date: '2026-03-31', tariff: { opening: { type: 'SEASON', fee: 100 } } });
    expect(body).not.toHaveProperty('season_start_date'); // optional for a tariff
  });

  it('editing sends only what changed, so renaming a plan in use is not mistaken for a rate change', async () => {
    plans = [TARIFF_PLAN];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    fireEvent.change(await screen.findByDisplayValue('Apple tariff'), { target: { value: 'Apple tariff (renamed)' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/rate-plans/plan-1', expect.objectContaining({ method: 'PATCH' })));
    const body = apiClient.mock.calls.find((c) => c[1]?.method === 'PATCH')![1].body;
    expect(body).toEqual({ name: 'Apple tariff (renamed)', commodity_id: POTATO.id, is_active: true });
  });

  it('changing the monthly rate while editing does send it', async () => {
    plans = [TARIFF_PLAN];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^edit$/i }));
    fireEvent.change(rateInput(), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/rate-plans/plan-1', expect.objectContaining({ method: 'PATCH' })));
    const body = apiClient.mock.calls.find((c) => c[1]?.method === 'PATCH')![1].body;
    expect(body).toMatchObject({ rate_amount_pkr: 31 });
    expect(body).not.toHaveProperty('tariff');
  });
});
