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
  isCashOrBank: () => false,
}));

import PayrollRunDetailPage from './page';

const RUN = {
  id: ID,
  run_number: 'PR-2026-08-001',
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
  line_items: [
    {
      id: 'line-1',
      employee_id: 'emp-1',
      employee_name: 'Ahmed',
      employee_type: 'DAILY_WAGE' as const,
      days_worked: 20,
      gross_pay_pkr: 1000,
      eobi_employee_pkr: 0,
      eobi_employer_pkr: 0,
      income_tax_pkr: 0,
      other_deductions_pkr: 0,
      advance_recovery_pkr: 0,
      net_pay_pkr: 1000,
    },
  ],
  reconciliation: null,
};

// Column order for a DAILY_WAGES draft run: Days, Gross, Tax, Advance.
const GROSS_INDEX = 1;

describe('PayrollRunDetailPage — inline line-item grid', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue(RUN);
  });

  it('does not corrupt Gross to 0 on an in-progress decimal keystroke, and stays undirtied', async () => {
    render(<PayrollRunDetailPage />);
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());

    const grossInput = screen.getAllByRole('spinbutton')[GROSS_INDEX] as HTMLInputElement;
    expect(grossInput.value).toBe('1000');

    // The exact intermediate state a browser produces for "1000." while
    // typing "1000.5" — a native number input sanitizes this to "".
    fireEvent.change(grossInput, { target: { value: '' } });

    // The buffer shows the in-progress edit, but nothing was written back to
    // draftLines — the row isn't dirty and Net Pay still reads off the
    // original 1000, not 0.
    expect(grossInput.value).toBe('');
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument(); // Net Pay cell, unchanged

    // Completing the number (as the next keystroke would) resumes normal
    // operation — this is what actually marks the row dirty.
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
    // Clearing the field never made it through to draftLines, so nothing is
    // dirty and there is no line to (mis)save.
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument();
  });
});
