import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'je-1' }),
  usePathname: () => '/accounting/journal-entries/je-1',
}));
const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { role: 'OWNER', permissions: [] } }) }));
vi.mock('@/lib/permissions', () => ({ can: () => true }));
vi.mock('@/components/form/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));

import JournalEntryDetailPage from './page';

const ENTRY = {
  id: 'je-1',
  entry_number: 'JE-000042',
  entry_date: '2026-03-01',
  entry_type: 'ADJUSTMENT',
  book_type: 'PACCI',
  source_table: 'owner_equity',
  source_id: 'x',
  description: 'Owner drawing (legacy)',
  posting_status: 'POSTED',
  reversed_by_id: null,
  reversed_by_entry_number: null,
  is_reversed: false,
  is_user_reversible: true,
  total_debit_pkr: 100,
  total_credit_pkr: 100,
  created_at: '2026-03-01T00:00:00Z',
  created_by_name: 'Owner',
  lines: [],
};

/**
 * Whether an entry may be reversed from the journal is the API's call
 * (JOURNAL_SOURCES). The page kept its own whitelist — manual and opening
 * balances only — so legacy owner-equity and cash-transfer entries, which the
 * API reverses, had no button (docs/25 L-09, L-11).
 */
describe('JournalEntryDetailPage — reverse and status follow the API', () => {
  beforeEach(() => apiClient.mockReset());

  it('offers Reverse whenever the API says the entry is user-reversible', async () => {
    apiClient.mockResolvedValue(ENTRY);
    render(<JournalEntryDetailPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /reverse entry/i })).toBeTruthy());
  });

  it('withholds it when the API says no, and shows a reversed entry as reversed', async () => {
    apiClient.mockResolvedValue({ ...ENTRY, source_table: 'manual', is_reversed: true, is_user_reversible: false });
    render(<JournalEntryDetailPage />);
    await waitFor(() => expect(screen.getByText('Reversed')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /reverse entry/i })).toBeNull();
  });
});
