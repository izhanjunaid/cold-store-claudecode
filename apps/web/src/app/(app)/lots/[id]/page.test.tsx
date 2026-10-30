import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const LOT_ID = 'lot-1';
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
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

// The form has its own tests; here only whether New Withdrawal opens the drawer for this lot.
vi.mock('@/components/outbound/withdraw-form', () => ({
  WithdrawForm: ({ lotId }: { lotId: string }) => <div data-testid="withdraw-form" data-lot-id={lotId} />,
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
  // The page reads the facility's settings (whether weights are shown) through React Query.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LotDetailPage />
    </QueryClientProvider>,
  );
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

  it('for the gate guard, whose bag counts arrive as null, shows dashes and does not crash', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    lot = { ...LOT, quantity_bags: null, current_balance_bags: null } as unknown as typeof LOT;
    await renderPage();
    expect(screen.getByRole('heading', { name: LOT.lot_number })).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('for the gate guard, whose weights arrive as null too, shows a dash for the weight and does not crash', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    lot = { ...LOT, quantity_bags: null, current_balance_bags: null, accepted_weight_kg: null } as unknown as typeof LOT;
    await renderPage();
    expect(screen.queryByText(/NaN|null kg/)).not.toBeInTheDocument();
    expect(screen.queryByText(/4,000/)).not.toBeInTheDocument();
  });

  // Weight optional (docs/27).
  it('with weights hidden the lot shows no weight row and no weight-dispute flag', async () => {
    lot = { ...LOT, declared_weight_kg: 4120, weight_dispute_flag: true, weight_dispute_note: 'Six bags wet' } as unknown as typeof LOT;
    apiClient.mockImplementation((path: string) =>
      Promise.resolve(
        path === `/v1/lots/${LOT_ID}` ? lot : path === '/v1/facilities/me' ? { id: 'fac-1', settings: { hide_weights: true } } : [],
      ),
    );
    await renderPage();
    await waitFor(() => expect(screen.queryByText('Weight (Accepted / Declared)')).not.toBeInTheDocument());
    expect(screen.queryByText('Weight dispute flag')).not.toBeInTheDocument();
    expect(screen.queryByText(/4,000/)).not.toBeInTheDocument();
  });

  it('with weights shown the lot keeps its weight row', async () => {
    await renderPage();
    expect(screen.getByText('Weight (Accepted / Declared)')).toBeInTheDocument();
  });

  it('the guard has no Billing tab (the API refuses them the invoices); everyone else does', async () => {
    role = 'SECURITY';
    permissions = ['gate_passes.log'];
    await renderPage();
    expect(screen.queryByRole('tab', { name: 'Billing' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Withdrawals' })).toBeInTheDocument();
  });

  it('an operator keeps the Billing tab', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    await renderPage();
    expect(screen.getByRole('tab', { name: 'Billing' })).toBeInTheDocument();
  });

  it('shows New Withdrawal only with outbound.record', async () => {
    permissions = ['outbound.record'];
    await renderPage();
    expect(screen.getByRole('button', { name: /new withdrawal/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transfer ownership/i })).toBeNull();
  });

  it('New Withdrawal opens the drawer for this lot instead of leaving the page', async () => {
    permissions = ['outbound.record'];
    push.mockReset();
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /new withdrawal/i }));

    expect(await screen.findByTestId('withdraw-form')).toHaveAttribute('data-lot-id', LOT_ID);
    expect(push).not.toHaveBeenCalled();
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
