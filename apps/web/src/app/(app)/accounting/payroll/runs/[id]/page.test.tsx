import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const ID = 'run-1';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: ID }),
  usePathname: () => `/accounting/payroll/runs/${ID}`,
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role: 'OWNER' } }),
}));

vi.mock('@/lib/permissions', () => ({ can: () => true, useCan: () => true }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks/use-reference-data', () => ({
  useAccounts: () => ({ data: [] }),
}));

import PayrollRunDetailPage from './page';

const LINE = {
  id: 'line-1',
  employee_id: 'emp-1',
  employee_name: 'Ahmed',
  employee_type: 'DAILY_WAGE' as const,
  days_worked: 20,
  gross_pay_pkr: 1000,
  eobi_employee_pkr: 0,
  eobi_employer_pkr: 0,
  income_tax_pkr: 0,
  advance_recovery_pkr: 0,
  net_pay_pkr: 1000,
};

const RUN = {
  id: ID,
  run_number: 'PAY-202608-001',
  payroll_type: 'DAILY_WAGES' as const,
  period_year: 2026,
  period_month: 8,
  period_from: '2026-08-01',
  period_to: '2026-08-31',
  total_gross_pkr: 1000,
  total_employer_eobi_pkr: 0,
  total_deductions_pkr: 0,
  total_net_payable_pkr: 1000,
  status: 'DRAFT' as const,
  payroll_journal_entry_id: null,
  payment_journal_entry_id: null,
  remittance_journal_entry_id: null,
  finalized_at: null,
  paid_at: null,
  notes: null,
  voided_at: null,
  void_reason: null,
  allowed_actions: ['edit_lines', 'finalize'],
  line_items: [LINE],
  salaries_payable: null,
};

const SALARY_RUN = {
  ...RUN,
  payroll_type: 'MONTHLY_SALARY' as const,
  line_items: [{ ...LINE, employee_type: 'SALARIED' as const, days_worked: null }],
};

describe('PayrollRunDetailPage — inline line-item grid', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(RUN);
  });

  it('does not corrupt Gross to 0 on an in-progress decimal keystroke, and stays undirtied', async () => {
    apiClient.mockResolvedValue(SALARY_RUN);
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());

    // Salaried line: Gross is the first input.
    const grossInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(grossInput.value).toBe('1000');

    // The exact intermediate state a browser produces for "1000." while
    // typing "1000.5" — a native number input sanitizes this to "".
    fireEvent.change(grossInput, { target: { value: '' } });

    expect(grossInput.value).toBe('');
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument(); // Net Pay cell, unchanged

    fireEvent.change(grossInput, { target: { value: '1000.5' } });
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
  });

  it('never sends draftLines.days_worked as null — an unparseable Days edit is simply not applied', async () => {
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());

    const daysInput = screen.getAllByRole('spinbutton')[0] as HTMLInputElement;
    expect(daysInput.value).toBe('20');

    fireEvent.change(daysInput, { target: { value: '' } });

    expect(daysInput.value).toBe('');
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });

  // docs/25 C-18: a daily-wage gross is days x wage, computed by the server.
  it('a daily-wage gross is not typed: it follows the days worked and only days are sent', async () => {
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());

    // Days, Tax, Advance — no Gross input on a daily-wage line.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(3);

    fireEvent.change(screen.getAllByRole('spinbutton')[0]!, { target: { value: '10' } });
    expect(screen.getAllByText('500').length).toBeGreaterThan(0); // 10 days x 50/day

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(`/v1/payroll-runs/${ID}/lines/line-1`, {
        method: 'PATCH',
        body: { income_tax_pkr: 0, advance_recovery_pkr: 0, days_worked: 10 },
      }),
    );
  });
});

describe('PayrollRunDetailPage — actions come from the server', () => {
  beforeEach(() => apiClient.mockReset());

  it('a paid run offers Void payment, never Reverse', async () => {
    apiClient.mockResolvedValue({ ...RUN, status: 'PAID', allowed_actions: ['void_payment'] });
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /void payment/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reverse run/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pay salaries$/i })).not.toBeInTheDocument();
  });

  it('a finalized run offers Pay and Reverse', async () => {
    apiClient.mockResolvedValue({ ...RUN, status: 'FINALIZED', allowed_actions: ['pay', 'reverse'] });
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /pay salaries/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reverse run/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /void payment/i })).not.toBeInTheDocument();
  });
});
