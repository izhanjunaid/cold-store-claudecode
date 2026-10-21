import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/invoices',
  useSearchParams: () => new URLSearchParams(),
}));

let user: { role: string; permissions: string[] } | null = null;
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user };
    return selector ? selector(state) : state;
  },
}));

// The table (URL-synced state via nuqs) and the dialogs are not what this test is about.
vi.mock('@/components/data-table', () => ({
  DataTable: () => null,
  useTableState: () => ({
    state: { page: 1, perPage: 25, sort: null, filters: {} },
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
  }),
}));
vi.mock('@/components/party/party-picker', () => ({ PartyPicker: () => null }));
vi.mock('@/components/billing/record-payment-sheet', () => ({ RecordPaymentSheet: () => null }));
vi.mock('@/components/billing/void-invoice-dialog', () => ({ VoidInvoiceDialog: () => null }));

// What the page asks the list hook for is what decides whether a request goes out.
const useListQuery = vi.fn((..._args: unknown[]) => ({ data: undefined, isLoading: false, isError: false }));
vi.mock('@/hooks/use-list-query', () => ({ useListQuery: (...a: unknown[]) => useListQuery(...a) }));

import InvoiceListPage from './page';

const lastOptions = () => useListQuery.mock.calls.at(-1)?.[3] as { enabled?: boolean } | undefined;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvoiceListPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useListQuery.mockClear();
  user = null;
});

describe('Invoices list — asks the server only once it knows the user may read invoices', () => {
  it('sends nothing while the signed-in user is still loading', () => {
    renderPage();
    expect(lastOptions()?.enabled).toBe(false);
  });

  it('sends nothing, and says so, to a user without billing.view', () => {
    user = { role: 'OPERATOR', permissions: ['outbound.record'] };
    renderPage();
    expect(lastOptions()?.enabled).toBe(false);
    expect(screen.getByText(/don.t have permission to view invoices/i)).toBeInTheDocument();
  });

  it('asks for the list once the user is known to hold billing.view', () => {
    user = { role: 'ACCOUNTANT', permissions: ['billing.view'] };
    renderPage();
    expect(lastOptions()?.enabled).toBe(true);
  });
});
