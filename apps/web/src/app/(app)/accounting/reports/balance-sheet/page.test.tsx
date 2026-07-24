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
  total_assets_pkr: 800,
  current_liability_groups: [],
  total_current_liabilities_pkr: 0,
  non_current_liability_groups: [],
  total_non_current_liabilities_pkr: 0,
  total_liabilities_pkr: 0,
  equity_lines: [],
  retained_earnings_pkr: 0,
  prior_years_pl_pkr: 0,
  current_year_pl_pkr: 800,
  fiscal_year_start: '2026-01-01',
  total_equity_pkr: 800,
  total_liabilities_and_equity_pkr: 800,
  is_balanced: true,
  unclassified_asset_lines: [
    { account_code: '9904', account_name: 'Custom Asset (stray)', amount_pkr: 800 },
  ],
  unclassified_liability_lines: [],
  has_unclassified: true,
};

describe('BalanceSheetPage — unclassified accounts surface on the statement (F-6b)', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(BASE_BS);
  });

  it('renders unclassified asset lines inside the assets block', async () => {
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.getAllByText(/Unclassified/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Custom Asset \(stray\)/)).toBeTruthy();
  });

  it('hides the section when everything is classified', async () => {
    apiClient.mockResolvedValue({
      ...BASE_BS,
      unclassified_asset_lines: [],
      has_unclassified: false,
      total_assets_pkr: 0,
      current_year_pl_pkr: 0,
      total_equity_pkr: 0,
      total_liabilities_and_equity_pkr: 0,
    });
    render(<BalanceSheetPage />);
    await waitFor(() => expect(screen.getByText(/Total Assets/)).toBeTruthy());
    expect(screen.queryByText(/Unclassified/)).toBeNull();
  });
});
