import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => ({ partyId: 'party-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reports/party-statement/party-1',
}));

const LEDGER = {
  party_name: 'Farmer One',
  opening_balance_pkr: 0,
  total_debit_pkr: 0,
  total_credit_pkr: 0,
  closing_balance_pkr: 0,
  entries: [],
};
const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role: 'ACCOUNTANT', permissions: ['reports.financial'] } };
    return selector ? selector(state) : state;
  },
}));

// The picker has its own queries and tests.
vi.mock('@/components/party/party-picker', () => ({ PartyPicker: () => null }));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

import PartyStatementDetailPage from './page';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PartyStatementDetailPage />
    </QueryClientProvider>,
  );
}

describe('Party statement — Download PDF', () => {
  const tab = { location: { href: '' }, close: vi.fn() };

  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(LEDGER);
    toastError.mockReset();
    tab.location.href = '';
    tab.close.mockReset();
    localStorage.setItem('access_token', 'token');
    localStorage.setItem('facility_id', 'facility');
    URL.createObjectURL = vi.fn(() => 'blob:statement');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  async function clickDownload() {
    const button = await screen.findByRole('button', { name: 'Download PDF' });
    await waitFor(() => expect(button).toBeEnabled()); // enabled once the statement has loaded
    fireEvent.click(button);
  }

  it('opens its tab at once, and fills it with the statement', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    let arrive!: (r: Response) => void;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((r) => (arrive = r)));
    renderPage();
    await clickDownload();

    expect(open).toHaveBeenCalledTimes(1); // before the PDF is back
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/\/v1\/reports\/party-statement\/party-1\?.*format=pdf/);
    arrive({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);
    await waitFor(() => expect(tab.location.href).toBe('blob:statement'));
  });

  it('a refused PDF shows an error and opens nothing: an error body is no statement', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    renderPage();
    await clickDownload();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Could not open the party statement \(500\)/)));
    expect(tab.close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1); // the waiting tab only, never the error as a PDF
  });
});
