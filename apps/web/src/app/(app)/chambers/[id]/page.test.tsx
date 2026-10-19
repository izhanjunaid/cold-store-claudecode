import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'c1' }),
  usePathname: () => '/chambers/c1',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));

let role = 'OPERATOR';
let permissions: string[] = [];
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RoomDetailPage from './page';

const detail = (over: Record<string, unknown> = {}, rackOcc: number | null = 160) => ({
  id: 'c1',
  name: 'Chamber C',
  commodity_restriction_name: null,
  max_capacity_bags: 5000,
  current_occupancy_bags: 380,
  temperature_min_c: 0,
  temperature_max_c: 5,
  is_active: true,
  notes: null,
  unplaced_bags: 120,
  temperature_logs: [],
  racks: [
    { id: 'r1', name: 'WALK-1', max_capacity_bags: 500, current_occupancy_bags: rackOcc, position: 1, is_active: true, notes: null },
  ],
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomDetailPage />
    </QueryClientProvider>,
  );
}

describe('RoomDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    role = 'OPERATOR';
    permissions = [];
  });

  it('shows the room’s and each rack’s fill', async () => {
    apiClient.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByText('8%')).toBeInTheDocument();
    expect(screen.getByText(/160 \/ 500 bags · 32%/)).toBeInTheDocument();
  });

  it('for the gate guard, whose counts arrive as null, shows dashes — never a false 0% — and does not crash', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    apiClient.mockResolvedValue(detail({ current_occupancy_bags: null, unplaced_bags: null }, null));
    renderPage();
    await screen.findByText('WALK-1');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/· 0%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText(/— \/ 500 bags · —/)).toBeInTheDocument();
    // "120 bags are not assigned to a rack" is a count: it must not appear for the guard.
    expect(screen.queryByText(/not assigned to a rack/)).not.toBeInTheDocument();
  });
});
