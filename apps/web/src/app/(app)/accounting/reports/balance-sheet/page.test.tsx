import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/reports/balance-sheet',
  useSearchParams: () => new URLSearchParams(),
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

vi.mock('@/components/accounting/statement-toolbar', () => ({
  StatementToolbar: () => null,
}));
vi.mock('@/components/accounting/ratios-strip', () => ({
  RatiosStrip: () => null,
}));
vi.mock('@/components/accounting/statement-frame', () => ({
  StatementFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  StatementSkeleton: () => null,
}));
vi.mock('@/components/accounting/use-statement-period', () => ({
  useStatementPeriod: () => ({
    preset: 'ytd',
    setPreset: vi.fn(),
    range: { date_from: '2026-01-01', date_to: '2026-06-30', as_of: '2026-06-30', label: 'FY26' },
    prior: { date_from: '2025-01-01', date_to: '2025-06-30', as_of: '2025-06-30', label: 'FY25' },
    setCustom: vi.fn(),
    bookType: '',
    setBookType: vi.fn(),
    compare: false,
    setCompare: vi.fn(),
  }),
}));

import BalanceSheetPage from './page';

const BASE_BS = {
  as_of_date: '2026-06-30',
  current_asset_groups: [],
  total_current_assets_pkr: 0,
  non_current_asset_groups: [],
  total_non_current_assets_pkr: 0,
  total_assets_pkr: 0,
  current_liability_groups: [],
  total_current_liabilities_pkr: 0,
  non_current_liability_groups: [],
  total_non_current_liabilities_pkr: 0,
  total_liabilities_pkr: 0,
  equity_lines: [],
  retained_earnings_pkr: 0,
  prior_years_pl_pkr: 0,
  current_year_pl_pkr: 0,
  fiscal_year_start: '2026-01-01',
  total_equity_pkr: 0,
  total_liabilities_and_equity_pkr: 0,
  is_balanced: true,
  unattributed_opening_equity_pkr: 0,
};

/**
 * A group's subtotal sits directly above its section's total. With one group in
 * the section — the seeded chart has a single header for current liabilities —
 * the two are the same figure, and the statement printed "Total Current
 * Liabilities" twice.
 */
describe('BalanceSheetPage — group subtotals', () => {
  const group = (code: string, name: string, amount: number) => ({
    code,
    name,
    lines: [{ account_code: `${code.slice(0, 2)}10`, account_name: `${name} line`, amount_pkr: amount }],
    subtotal_pkr: amount,
  });

  beforeEach(() => {
    apiClient.mockReset();
  });

  it('a section with one group prints its total once', async () => {
    apiClient.mockResolvedValue({
      ...BASE_BS,
      current_liability_groups: [group('2000', 'Current Liabilities', 500)],
      total_current_liabilities_pkr: 500,
    });
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.getAllByText('Total Current Liabilities')).toHaveLength(1);
  });

  it('a section with several groups keeps each group subtotal', async () => {
    apiClient.mockResolvedValue({
      ...BASE_BS,
      current_asset_groups: [group('1000', 'Cash & Bank', 300), group('1100', 'Trade Receivables', 200)],
      total_current_assets_pkr: 500,
    });
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.getByText('Total Cash & Bank')).toBeTruthy();
    expect(screen.getByText('Total Trade Receivables')).toBeTruthy();
    expect(screen.getByText('Total Current Assets')).toBeTruthy();
  });
});

/**
 * The opening-balance plug renders as an ordinary equity row, so once the owners
 * have capital accounts of their own an unattributed residual reads on the face
 * of the statement as somebody's capital. The server decides whether the
 * question applies at all; the page only has to say so when it does.
 */
describe('BalanceSheetPage — unattributed opening equity', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('names the residual when the server reports one', async () => {
    apiClient.mockResolvedValue({ ...BASE_BS, unattributed_opening_equity_pkr: 370000 });
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.getByText(/has not been attributed to any owner/)).toBeTruthy();
    expect(screen.getByText(/370,000/)).toBeTruthy();
  });

  it('stays silent once equity is attributed in full — zero is not a warning', async () => {
    apiClient.mockResolvedValue({ ...BASE_BS, unattributed_opening_equity_pkr: 0 });
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.queryByText(/has not been attributed/)).toBeNull();
  });
});
