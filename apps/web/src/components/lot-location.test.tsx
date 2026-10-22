import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));

let role = 'OPERATOR';
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions: [] as string[] } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { LotLocationCard } from './lot-location';

const placements = (bags: number | null) => ({
  lot_id: 'lot-1',
  chamber_id: 'c1',
  chamber_name: 'Chamber C',
  current_balance_bags: bags,
  placements: [
    { rack_id: 'r1', rack_name: 'R-1', bags },
    { rack_id: 'r2', rack_name: 'R-2', bags: bags === null ? null : 50 },
  ],
  unplaced_bags: bags === null ? null : 0,
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LotLocationCard lotId="lot-1" canOperate={false} />
    </QueryClientProvider>,
  );
}

describe('LotLocationCard', () => {
  beforeEach(() => {
    apiClient.mockReset();
    role = 'OPERATOR';
  });

  it('shows each rack with its bag count, and the placement slip', async () => {
    apiClient.mockResolvedValue(placements(200));
    renderCard();
    expect(await screen.findByText('R-1 × 200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /placement slip/i })).toBeInTheDocument();
  });

  it('for the gate guard, whose counts arrive as null, names the racks only and has no placement slip', async () => {
    role = 'SECURITY';
    apiClient.mockResolvedValue(placements(null));
    renderCard();
    expect(await screen.findByText('R-1')).toBeInTheDocument();
    expect(screen.getByText('R-2')).toBeInTheDocument();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /placement slip/i })).not.toBeInTheDocument();
  });
});
