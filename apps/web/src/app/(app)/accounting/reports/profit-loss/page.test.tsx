import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/reports/profit-loss',
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
    preset: 'this_fy',
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

import ProfitLossPage from './page';

const BASE_PL = {
  date_from: '2026-01-01',
  date_to: '2026-06-30',
  revenue_groups: [],
  total_operating_revenue_pkr: 0,
  contra_revenue_lines: [],
  total_contra_revenue_pkr: 0,
  net_revenue_pkr: 0,
  cost_of_service_lines: [],
  total_cost_of_service_pkr: 0,
  gross_profit_pkr: 0,
  gross_profit_pct: 0,
  operating_expense_lines: [],
  total_operating_expense_pkr: 0,
  operating_profit_pkr: 0,
  operating_profit_pct: 0,
  other_income_lines: [],
  total_other_income_pkr: 0,
  depreciation_amortisation_pkr: 0,
  ebitda_pkr: 0,
  ebitda_pct: 0,
  net_profit_pkr: -500,
  net_profit_pct: 0,
  unclassified_lines: [
    { account_code: '7010', account_name: 'Interest Expense (custom)', amount_pkr: -500 },
  ],
  total_unclassified_pkr: -500,
  has_unclassified: true,
};

describe('ProfitLossPage — unclassified accounts surface on the statement (F-6b)', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(BASE_PL);
  });

  it('renders the unclassified section with its lines and subtotal', async () => {
    render(<ProfitLossPage />);
    await waitFor(() => expect(screen.getAllByText(/Unclassified/).length).toBeGreaterThan(0));
    expect(screen.getByText(/Interest Expense \(custom\)/)).toBeTruthy();
  });

  it('hides the section when everything is classified', async () => {
    apiClient.mockResolvedValue({ ...BASE_PL, unclassified_lines: [], total_unclassified_pkr: 0, has_unclassified: false, net_profit_pkr: 0 });
    render(<ProfitLossPage />);
    await waitFor(() => expect(screen.getByText(/Net Profit/)).toBeTruthy());
    expect(screen.queryByText(/Unclassified/)).toBeNull();
  });
});
