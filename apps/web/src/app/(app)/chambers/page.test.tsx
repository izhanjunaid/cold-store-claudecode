import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/chambers',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));

import RoomListPage from './page';

const room = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Chamber C',
  commodity_restriction_name: null,
  max_capacity_bags: 5000,
  current_occupancy_bags: 380,
  rack_count: 10,
  temperature_min_c: 0,
  temperature_max_c: 5,
  last_temperature: null,
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomListPage />
    </QueryClientProvider>,
  );
}

describe('RoomListPage', () => {
  beforeEach(() => apiClient.mockReset());

  it('shows each room’s fill', async () => {
    apiClient.mockResolvedValue([room()]);
    renderPage();
    expect(await screen.findByText('8%')).toBeInTheDocument();
    expect(screen.getByText(/380 \/ 5,000 bags/)).toBeInTheDocument();
  });

  it('for the gate guard, whose occupancy arrives as null, shows dashes — never a false 0%', async () => {
    apiClient.mockResolvedValue([room({ current_occupancy_bags: null })]);
    renderPage();
    await screen.findByText('Chamber C');
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText(/— \/ 5,000 bags/)).toBeInTheDocument();
    // the percentage cell is a dash too
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});
