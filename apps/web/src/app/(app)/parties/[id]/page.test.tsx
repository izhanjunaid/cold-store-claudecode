import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/parties/p1',
}));

const apiClient = vi.fn();
const apiClientList = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...a: unknown[]) => apiClient(...a),
  apiClientList: (...a: unknown[]) => apiClientList(...a),
}));
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { role: 'OWNER', permissions: [] } }) }));
vi.mock('@/lib/permissions', () => ({ can: () => true }));
vi.mock('@/components/form', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/use-api-mutation', () => ({ useApiMutation: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock('@/components/billing/record-payment-sheet', () => ({ RecordPaymentSheet: () => null }));
vi.mock('@/components/party/issue-loan-dialog', () => ({ IssueLoanDialog: () => null }));

import PartyDetailPage from './page';

const PARTY = {
  id: 'p1',
  name: 'Ghulam Hussain',
  name_urdu: null,
  party_type: 'FARMER',
  phone_primary: '03001234567',
  phone_secondary: null,
  address: null,
  cnic: null,
  parent_arhti_id: null,
  parent_arhti_name: null,
  credit_limit_pkr: null,
  credit_terms_days: 30,
  is_active: true,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
};
const LOT = { id: 'l1', lot_number: 'LOT-0001', commodity_name: 'Potato', current_balance_bags: 50, status: 'ACTIVE', inbound_date: '2026-01-02' };

/**
 * The Active Lots tab asked /v1/lots for owner_party_id, a name the endpoint does not
 * know — so it was dropped and the tab listed the facility's lots, whoever owned them.
 */
describe('PartyDetailPage — the tabs list this party only, and say when there is more', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClientList.mockReset();
    apiClient.mockImplementation((url: string) =>
      Promise.resolve(url === '/v1/parties/p1' ? PARTY : { entries: [], total_debit_pkr: 0, total_credit_pkr: 0, closing_balance_pkr: 0 }),
    );
    apiClientList.mockImplementation((url: string) =>
      Promise.resolve(url.startsWith('/v1/lots') ? { data: [LOT], meta: { page: 1, per_page: 100, total: 130 } } : { data: [], meta: { page: 1, per_page: 100, total: 0 } }),
    );
  });

  it('asks for the party’s lots by the filter the endpoint takes', async () => {
    render(<PartyDetailPage />);
    await waitFor(() => expect(apiClientList).toHaveBeenCalledWith(expect.stringMatching(/^\/v1\/lots\?/)));
    const url = apiClientList.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/v1/lots'))!;
    expect(url).toContain('party_id=p1');
    expect(url).not.toContain('owner_party_id');
    expect(url).toContain('per_page=100');
  });

  it('links to the full, filtered list when the tab holds only the first rows', async () => {
    render(<PartyDetailPage />);
    await waitFor(() => expect(screen.getByText(/Showing 1 of 130/)).toBeTruthy());
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/lots?status=ACTIVE&party_id=p1');
  });
});
