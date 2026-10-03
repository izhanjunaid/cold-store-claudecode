import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/reports/cash-flow',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('@/components/accounting/statement-toolbar', () => ({ StatementToolbar: () => null }));
vi.mock('@/components/accounting/statement-frame', () => ({
  StatementFrame: ({ children, title, note }: { children: React.ReactNode; title: string; note?: string }) => (
    <div>
      <h2>{title}</h2>
      {children}
      <p>{note}</p>
    </div>
  ),
  StatementSkeleton: () => null,
}));
vi.mock('@/components/accounting/use-statement-period', () => ({
  useStatementPeriod: () => ({
    preset: 'this_fy',
    setPreset: vi.fn(),
    range: { date_from: '2025-07-01', date_to: '2026-06-30', as_of: '2026-06-30', label: 'FY 2025–26' },
    prior: { date_from: '2024-07-01', date_to: '2025-06-30', as_of: '2025-06-30', label: 'Prior year' },
    setCustom: vi.fn(),
    bookType: 'KATCHI',
    setBookType: vi.fn(),
    compare: false,
    setCompare: vi.fn(),
  }),
}));

import CashFlowPage from './page';

const line = (account_code: string, account_name: string, amount_pkr: number) => ({ account_code, account_name, amount_pkr });

const CF = {
  date_from: '2025-07-01',
  date_to: '2026-06-30',
  operating_lines: [line('4150', 'Other Service Revenue', 1000)],
  total_operating_pkr: 1000,
  investing_lines: [line('1310', 'Cold Storage Plant & Equipment', -50000)],
  total_investing_pkr: -50000,
  financing_lines: [line('2110', 'Bank Loan — Equipment Finance', 200000)],
  total_financing_pkr: 200000,
  net_change_pkr: 151000,
  opening_cash_pkr: 0,
  closing_cash_pkr: 151000,
  cash_composition: [line('1020', 'Bank Account — Main', 151000)],
  cheques_in_hand_pkr: 0,
  is_reconciled: true,
};

/** On the statement kit like every other statement (docs/25 L-37). */
describe('CashFlowPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(CF);
  });

  it('asks for the fiscal-year range in the chosen book and shows all three sections', async () => {
    render(<CashFlowPage />);
    await waitFor(() => expect(screen.getByText('Statement of Cash Flows')).toBeTruthy());
    expect(apiClient).toHaveBeenCalledWith('/v1/accounting/cash-flow?date_from=2025-07-01&date_to=2026-06-30&book_type=KATCHI');
    expect(screen.getByText(/Net cash from investing activities/)).toBeTruthy();
    expect(screen.getByText('Cold Storage Plant & Equipment')).toBeTruthy();
    expect(screen.getByText('Bank Loan — Equipment Finance')).toBeTruthy();
  });

  it('says so on its face when it does not reconcile to the balance sheet', async () => {
    apiClient.mockResolvedValue({ ...CF, is_reconciled: false });
    render(<CashFlowPage />);
    await waitFor(() => expect(screen.getByText(/does not reconcile/)).toBeTruthy());
  });
});
