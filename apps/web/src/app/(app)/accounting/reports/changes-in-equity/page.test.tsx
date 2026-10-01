import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/reports/changes-in-equity',
  useSearchParams: () => searchParams,
}));
let searchParams = new URLSearchParams();

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('@/components/accounting/statement-toolbar', () => ({ StatementToolbar: () => null }));
vi.mock('@/components/accounting/statement-frame', () => ({
  StatementFrame: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h2>{title}</h2>
      {children}
    </div>
  ),
  StatementSkeleton: () => null,
}));
vi.mock('@/hooks/use-reference-data', () => ({ useFacility: () => ({ data: { settings: {} } }) }));

import ChangesInEquityPage from './page';

const column = (account_code: string, account_name: string, closing_pkr: number, partner_name: string | null = null) => ({
  account_code,
  account_name,
  role: 'PARTNER_CAPITAL',
  partner_name,
  opening_pkr: 0,
  capital_introduced_pkr: closing_pkr,
  drawings_pkr: 0,
  other_movements_pkr: 0,
  result_pkr: 0,
  transfer_pkr: 0,
  closing_pkr,
});

const BASE = {
  date_from: '2026-01-01',
  date_to: '2026-12-31',
  columns: [column('3110', 'Junaid — Capital', 500000, 'Junaid'), column('3120', 'Umair — Capital', 300000, 'Umair')],
  total_opening_pkr: 0,
  total_capital_introduced_pkr: 800000,
  total_drawings_pkr: 0,
  total_other_movements_pkr: 0,
  total_result_pkr: 1000000,
  total_closing_pkr: 1800000,
  is_reconciled: true,
  result_is_unallocated: true,
  result_allocation: null as unknown,
};

const mount = (data: Record<string, unknown>) => {
  apiClient.mockReset();
  apiClient.mockResolvedValue({ ...BASE, ...data });
  return render(<ChangesInEquityPage />);
};

describe('ChangesInEquityPage — the one equity roll-forward (L-24)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a year-end transfer row only when the range crosses a year end', async () => {
    mount({
      columns: [
        { ...column('3020', 'Retained Earnings', 900), role: 'RETAINED_EARNINGS', capital_introduced_pkr: 0, transfer_pkr: 900 },
        { ...column('3030', 'Current Year Profit / (Loss)', 50), role: 'CURRENT_YEAR_RESULT', capital_introduced_pkr: 0, result_pkr: 950, transfer_pkr: -900 },
      ],
    });
    await waitFor(() => expect(screen.getByText(/Transfer to retained earnings/)).toBeTruthy());
  });

  it('has no transfer row when nothing crossed a year end', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/Closing balance/)).toBeTruthy());
    expect(screen.queryByText(/Transfer to retained earnings/)).toBeNull();
  });

  it('names the owner a column belongs to', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/3110 · Junaid/)).toBeTruthy());
  });

  it('opens on the period the P&L linked from, in that book', async () => {
    searchParams = new URLSearchParams({ date_from: '2026-02-01', date_to: '2026-04-30', book_type: 'KATCHI' });
    try {
      mount({});
      await waitFor(() =>
        expect(apiClient).toHaveBeenCalledWith(
          '/v1/accounting/changes-in-equity?date_from=2026-02-01&date_to=2026-04-30&book_type=KATCHI',
        ),
      );
    } finally {
      searchParams = new URLSearchParams();
    }
  });
});

/**
 * IFRS for SMEs 4.13 asks for the changes in EACH category of equity, and the
 * result is the largest change of all. It used to reach no owner at all:
 * result_pkr was 0 on every column and result_is_unallocated was hardcoded true.
 */
describe('ChangesInEquityPage — whose the result is', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says plainly that nothing is divided when no ratio exists', async () => {
    mount({ result_allocation: null, result_is_unallocated: true });
    await waitFor(() =>
      expect(screen.getByText(/no profit-sharing ratio has been agreed/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Result attributable to each owner/)).toBeNull();
  });

  it('names each owner and their share once a ratio is agreed', async () => {
    mount({
      result_is_unallocated: false,
      result_allocation: {
        by_partner: [
          { partner_id: 'a', partner_name: 'Junaid', capital_account_code: '3110', amount_pkr: 750000 },
          { partner_id: 'b', partner_name: 'Umair', capital_account_code: '3120', amount_pkr: 250000 },
        ],
        unallocated_pkr: 0,
        windows: [{ from: '2026-01-01', to: '2026-12-31', result_pkr: 1000000, ratio_from: '2026-01-01' }],
      },
    });
    await waitFor(() => expect(screen.getByText(/Result attributable to each owner/)).toBeTruthy());
    expect(screen.getByText(/750,000/)).toBeTruthy();
    expect(screen.getByText(/250,000/)).toBeTruthy();
  });

  // The distinction that keeps the statement honest: nothing has been posted, so
  // the columns above still show contributions less drawings. Claiming otherwise
  // would make this statement disagree with the balance sheet.
  it('says the share has not been moved into their accounts', async () => {
    mount({
      result_is_unallocated: false,
      result_allocation: {
        by_partner: [
          { partner_id: 'a', partner_name: 'Junaid', capital_account_code: '3110', amount_pkr: 1000000 },
        ],
        unallocated_pkr: 0,
        windows: [{ from: '2026-01-01', to: '2026-12-31', result_pkr: 1000000, ratio_from: '2026-01-01' }],
      },
    });
    await waitFor(() => expect(screen.getByText(/has not been transferred/i)).toBeTruthy());
  });

  it('flags the part earned before any ratio took effect', async () => {
    mount({
      result_is_unallocated: true,
      result_allocation: {
        by_partner: [
          { partner_id: 'a', partner_name: 'Junaid', capital_account_code: '3110', amount_pkr: 500000 },
        ],
        unallocated_pkr: 500000,
        windows: [
          { from: '2026-01-01', to: '2026-06-30', result_pkr: 500000, ratio_from: null },
          { from: '2026-07-01', to: '2026-12-31', result_pkr: 500000, ratio_from: '2026-07-01' },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText(/Undivided/)).toBeTruthy());
    expect(screen.getByText(/earned before any ratio took effect/i)).toBeTruthy();
  });

  // 4.13's second limb — the rights attaching to each category.
  it('discloses which ratio applied over what, and why this is equity at all', async () => {
    mount({
      result_is_unallocated: false,
      result_allocation: {
        by_partner: [
          { partner_id: 'a', partner_name: 'Junaid', capital_account_code: '3110', amount_pkr: 1000000 },
        ],
        unallocated_pkr: 0,
        windows: [{ from: '2026-01-01', to: '2026-12-31', result_pkr: 1000000, ratio_from: '2026-03-15' }],
      },
    });
    await waitFor(() => expect(screen.getByText(/ratio agreed on 2026-03-15/)).toBeTruthy());
    expect(screen.getByText(/repayable on agreement between the owners/)).toBeTruthy();
  });
});
