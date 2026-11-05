import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

vi.mock('@/components/settings/software-version', () => ({ SoftwareVersion: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SettingsPage from './page';

const SETTINGS = {
  weight_dispute_threshold_kg: 5,
  storage_alert_thresholds: {},
  gst_registered: false,
  number_format: 'en-PK',
  chamber_capacity_warning_pct: 90,
  backdating_max_days: 7,
  gst_default_rate: 18,
  late_payment_surcharge: { enabled: false, pct_per_month: 2, grace_days: 30 },
  cash_tracking_from: null,
  dispatch_solo_mode: false,
  hide_weights: false,
  book_only_trucks_inside: false,
};
let settings: Record<string, unknown> = SETTINGS;
const facility = () => ({ id: 'fac-1', name: 'Cold Store', address: null, city: 'Lahore', phone: null, gst_number: null, settings });

beforeEach(() => {
  apiClient.mockReset();
  settings = SETTINGS;
  apiClient.mockImplementation((path: string, opts?: { method?: string; body?: { settings?: Record<string, unknown> } }) => {
    if (path === '/v1/facilities/me' && opts?.method === 'PATCH') {
      return Promise.resolve({ ...facility(), settings: { ...settings, ...(opts.body?.settings ?? {}) } });
    }
    if (path === '/v1/facilities/me') return Promise.resolve(facility());
    if (path === '/v1/commodities') return Promise.resolve([]);
    return Promise.resolve(null);
  });
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

const switchBox = () => screen.findByRole('checkbox', { name: /book only trucks inside the gate/i });
const patchedSettings = () => {
  const call = apiClient.mock.calls.find(([p, o]) => p === '/v1/facilities/me' && (o as { method?: string })?.method === 'PATCH');
  return (call?.[1] as { body: { settings: Record<string, unknown> } } | undefined)?.body.settings;
};

describe('Settings — Book only trucks inside the gate (docs/28 D2)', () => {
  it('is off for a facility that never saved it, and explains who it binds', async () => {
    renderPage();
    expect(await switchBox()).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/A manager can still type a plate to book ahead/i)).toBeInTheDocument();
  });

  it('shows the saved value', async () => {
    settings = { ...SETTINGS, book_only_trucks_inside: true };
    renderPage();
    expect(await switchBox()).toHaveAttribute('aria-checked', 'true');
  });

  it('is saved with the rest of the settings', async () => {
    renderPage();
    fireEvent.click(await switchBox());
    // The page offers Save twice (header and foot): either sends everything.
    fireEvent.click(screen.getAllByRole('button', { name: /save settings/i })[0]!);
    await waitFor(() => expect(patchedSettings()).toBeDefined());
    expect(patchedSettings()).toMatchObject({ book_only_trucks_inside: true });
  });
});
