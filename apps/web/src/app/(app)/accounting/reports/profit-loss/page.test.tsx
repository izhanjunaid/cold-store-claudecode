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
  StatementFrame: ({ children, note }: { children: React.ReactNode; note?: string }) => (
    <div>
      {children}
      <p>{note}</p>
    </div>
  ),
  StatementSkeleton: () => null,
}));

const accrualEnabled = vi.fn(() => false);
vi.mock('@/hooks/use-reference-data', () => ({
  // Accrual is "on" for a report when its start date falls on or before the period end.
  useFacility: () => ({ data: { settings: { revenue_accrual: { start_date: accrualEnabled() ? '2000-07-01' : null } } } }),
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

const EXPENSE = { account_code: '6010', account_name: 'Salaries' };

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
  operating_expense_lines: [{ ...EXPENSE, amount_pkr: 500 }],
  total_operating_expense_pkr: 500,
  operating_profit_pkr: -500,
  operating_profit_pct: 0,
  other_income_lines: [],
  total_other_income_pkr: 0,
  other_expense_lines: [],
  total_other_expense_pkr: 0,
  depreciation_amortisation_pkr: 0,
  impairment_pkr: 0,
  ebitda_pkr: -500,
  ebitda_pct: 0,
  net_profit_pkr: -500,
  net_profit_pct: 0,
};

describe('ProfitLossPage — one equity roll-forward (L-24)', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(BASE_PL);
    accrualEnabled.mockReturnValue(false);
  });

  it('carries no equity block of its own and links to Changes in Equity for the same period', async () => {
    render(<ProfitLossPage />);
    await waitFor(() => expect(screen.getByText(/Net Loss/)).toBeTruthy());
    expect(screen.queryByText(/Owner's equity, opening/)).toBeNull();
    const link = screen.getByRole('link', { name: /Changes in Equity/ });
    expect(link.getAttribute('href')).toContain('date_from=2026-01-01');
    expect(link.getAttribute('href')).toContain('date_to=2026-06-30');
  });
});

describe('ProfitLossPage — the basis note states the policy actually in force', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(BASE_PL);
  });

  it('says no accrual is made when accrual is off', async () => {
    accrualEnabled.mockReturnValue(false);
    render(<ProfitLossPage />);
    await waitFor(() => expect(screen.getByText(/no month-end accrual is made/)).toBeTruthy());
  });

  it('does NOT claim that once JE-25 is running', async () => {
    accrualEnabled.mockReturnValue(true);
    render(<ProfitLossPage />);
    await waitFor(() => expect(screen.getByText(/recognized as it is earned/)).toBeTruthy());
    expect(screen.queryByText(/no month-end accrual is made/)).toBeNull();
  });
});
