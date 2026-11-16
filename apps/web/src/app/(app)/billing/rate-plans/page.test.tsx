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

const rateInput = () => screen.getByText(/Price per bag per month/).parentElement!.querySelector('input') as HTMLInputElement;
const dateInputs = () => Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
const dateUnder = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('input') as HTMLInputElement;

async function openNewTariffPlan() {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /new rate plan/i }));
  fireEvent.click(await screen.findByRole('radio', { name: /Custom rule/ }));
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
      if (path.startsWith('/v1/parties')) return Promise.resolve([]);
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

  // Found in a real browser: the tariff form made the dialog 900px tall with no scrolling, so on a
  // laptop-height window the title and the Create button were off-screen and unreachable.
  // jsdom has no layout, so pin the two classes that make it scroll.
  it('the dialog caps its height and scrolls, so Create stays reachable on a short window', async () => {
    await openNewTariffPlan();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('max-h-[90vh]');
    expect(dialog.className).toContain('overflow-y-auto');
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

describe('RatePlanListPage — "How do you charge?" (docs/32 section 2.5)', () => {
  beforeEach(() => {
    apiClient.mockReset();
    plans = [];
    apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith('/v1/parties')) return Promise.resolve([]);
      if (path.startsWith('/v1/commodities')) return Promise.resolve([{ ...POTATO, unit_label: 'Crates', unit_name: 'Crate' }]);
      if (path.startsWith('/v1/rate-plans') && !opts?.method) return Promise.resolve(plans);
      return Promise.resolve({});
    });
  });

  const open = async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /new rate plan/i }));
    fireEvent.change(await screen.findByPlaceholderText(/Potato Seasonal 2026/), { target: { value: 'My rate' } });
  };
  const price = (label: RegExp) => screen.getByText(label).parentElement!.querySelector('input') as HTMLInputElement;
  const posted = async () => {
    fireEvent.click(screen.getByRole('button', { name: /create rate plan/i }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/rate-plans', expect.objectContaining({ method: 'POST' })));
    return apiClient.mock.calls.find((c) => c[1]?.method === 'POST')![1].body;
  };

  it('offers five ways to charge, starts on "Per season", and asks for the price in the unit of the goods', async () => {
    await open();
    expect(screen.getAllByRole('radio').map((r) => r.textContent!.replace(/\..*/, ''))).toHaveLength(5);
    expect(screen.getByRole('radio', { name: /Per season/ })).toHaveAttribute('aria-checked', 'true');
    // The store's goods are in crates, so the price is per crate.
    expect(await screen.findByText(/Price per crate for the season/)).toBeInTheDocument();
  });

  it('"Per month" shows worked examples and sends a monthly plan', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Per month/ }));
    fireEvent.change(price(/Price per crate per month/), { target: { value: '40' } });
    // 100 units: 20 days = 1 month, 45 days = 2 months, 100 days = 4 months.
    expect(screen.getByTestId('example-bills').textContent).toMatch(/20 days = Rs 4,000.*45 days = Rs 8,000.*100 days = Rs 16,000/);
    expect(await posted()).toMatchObject({ rate_type: 'MONTHLY_PER_BAG', rate_amount_pkr: 40 });
  });

  it('"Half a month, then months" needs only a price and sends the adhi-month rule, with no rule builder on screen', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Half a month, then months/ }));
    fireEvent.change(price(/Price per crate per month/), { target: { value: '30' } });
    expect(screen.queryByDisplayValue(/Choose one, then change/)).not.toBeInTheDocument();
    // 20 days = half a month + 5 days: 100 x (15 + 5) = Rs 2,000.
    expect(screen.getByTestId('example-bills').textContent).toMatch(/20 days = Rs 2,000/);
    expect(await posted()).toMatchObject({
      rate_type: 'TARIFF_PER_BAG',
      rate_amount_pkr: 30,
      tariff: { opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } },
    });
  });

  it('"Custom rule" opens the full rule builder', async () => {
    await open();
    fireEvent.click(screen.getByRole('radio', { name: /Custom rule/ }));
    expect(await screen.findByDisplayValue(/Choose one, then change/)).toBeInTheDocument();
  });
});
