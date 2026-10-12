import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const LOT_ID = 'lot-1';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: LOT_ID }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => `/lots/${LOT_ID}`,
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

let role = 'OPERATOR';
let permissions: string[] = [];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));

// The location card has its own queries; here we only care what the page lets it do.
vi.mock('@/components/lot-location', () => ({
  LotLocationCard: ({ canOperate }: { canOperate: boolean }) => (
    <div data-testid="lot-location" data-can-operate={String(canOperate)} />
  ),
  LotMovementsTimeline: () => null,
}));

import LotDetailPage from './page';

const LOT = {
  id: LOT_ID,
  lot_number: 'LOT-260101-0001',
  status: 'ACTIVE',
  owner_party_id: 'party-1',
  owner_party_name: 'Farmer One',
  billing_party_id: 'party-1',
  billing_party_name: 'Farmer One',
  commodity_name: 'POTATO',
  variety_name: null,
  chamber_name: 'Room 1',
  rate_plan_name: null,
  quantity_bags: 40,
  current_balance_bags: 40,
  accepted_weight_kg: 4000,
  declared_weight_kg: null,
  weight_dispute_flag: false,
  weight_dispute_note: null,
  quality_grade_inbound: null,
  inbound_date: '2026-01-01',
  entry_date: '2026-01-01',
  vehicle_number: null,
  marka: null,
  book_type: 'PACCI',
  notes: null,
  days_in_storage: 10,
  closed_at: null,
  created_at: '2026-01-01T08:00:00Z',
};

let lot: typeof LOT = LOT;

async function renderPage() {
  render(<LotDetailPage />);
  await screen.findByRole('heading', { name: LOT.lot_number });
}

describe('LotDetailPage actions', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockImplementation((path: string) =>
      Promise.resolve(path === `/v1/lots/${LOT_ID}` ? lot : []),
    );
    lot = LOT;
    role = 'OPERATOR';
    permissions = [];
  });

  it('shows New Withdrawal only with outbound.record', async () => {
    permissions = ['outbound.record'];
    await renderPage();
    expect(screen.getByRole('button', { name: /new withdrawal/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).toBeNull();
  });

  it('shows Transfer Ownership only with lots.transfer_ownership', async () => {
    // A role that once passed the hard-coded list but was granted only the transfer key.
    role = 'MANAGER';
    permissions = ['lots.transfer_ownership'];
    await renderPage();
    expect(screen.getByRole('button', { name: /transfer ownership/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new withdrawal/i })).toBeNull();
  });

  it('hides both actions without the keys, even for a senior role', async () => {
    role = 'MANAGER';
    permissions = ['lots.view'];
    await renderPage();
    expect(screen.queryByRole('button', { name: /new withdrawal/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).toBeNull();
  });

  it('withdrawal rights alone do not let the location card place or move bags', async () => {
    permissions = ['outbound.record'];
    await renderPage();
    expect(screen.getByTestId('lot-location')).toHaveAttribute('data-can-operate', 'false');
  });

  it('lets the location card place and move with lots.manage on an active lot', async () => {
    permissions = ['lots.manage'];
    await renderPage();
    expect(screen.getByTestId('lot-location')).toHaveAttribute('data-can-operate', 'true');
    expect(screen.queryByRole('button', { name: /new withdrawal/i })).toBeNull();
    expect(screen.getByRole('button', { name: /print receipt/i })).toBeInTheDocument();
  });

  it('offers Print Receipt only with lots.manage (the receipt route needs it)', async () => {
    permissions = ['outbound.record'];
    await renderPage();
    expect(screen.queryByRole('button', { name: /print receipt/i })).toBeNull();
  });

  it('offers no actions on a closed lot, even to the owner', async () => {
    role = 'OWNER';
    lot = { ...LOT, status: 'CLOSED', current_balance_bags: 0 };
    await renderPage();
    expect(screen.queryByRole('button', { name: /new withdrawal/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).toBeNull();
    expect(screen.getByTestId('lot-location')).toHaveAttribute('data-can-operate', 'false');
  });
});
