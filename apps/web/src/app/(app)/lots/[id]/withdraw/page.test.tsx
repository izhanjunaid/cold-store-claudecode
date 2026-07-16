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

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import WithdrawPage from './page';

const LOT = {
  id: LOT_ID,
  lot_number: 'LOT-260101-0001',
  status: 'ACTIVE',
  owner_party_name: 'Farmer One',
  commodity_name: 'POTATO',
  current_balance_bags: 40,
};
const RECEIVING_PARTY = { id: 'party-2', name: 'Trader Two', party_type: 'TRADER', is_active: true };
const FACILITY = { id: 'fac-1', name: 'Test Facility', settings: { backdating_max_days: 3 } };

function routeApiClient() {
  apiClient.mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === `/v1/lots/${LOT_ID}`) return Promise.resolve(LOT);
    if (path.startsWith('/v1/parties')) return Promise.resolve([RECEIVING_PARTY]);
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

describe('WithdrawPage — searchable receiving party', () => {
  beforeEach(() => {
    push.mockReset();
    apiClient.mockReset();
    routeApiClient();
  });

  it('picks the receiving party via the searchable combobox and submits it', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    fireEvent.click(await screen.findByTestId('combobox-receiving_party_id'));
    fireEvent.click(await screen.findByText('Trader Two'));

    fireEvent.click(screen.getByRole('button', { name: /create withdrawal/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/v1/outbound-events',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ receiving_party_id: 'party-2' }),
        }),
      ),
    );
  }, 10_000);

  it('warns client-side when the outbound date exceeds the facility backdating window', async () => {
    renderPage();
    await screen.findByText('LOT-260101-0001');

    const dateInput = screen.getByLabelText(/^Outbound date/);
    fireEvent.change(dateInput, { target: { value: '2026-01-01' } });

    await waitFor(() => expect(screen.getByText(/backdated/i)).toBeInTheDocument());
    expect(screen.getByText(/manager approval/i)).toBeInTheDocument();
  });
});
