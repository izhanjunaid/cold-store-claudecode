import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/opening-balances',
}));

const apiClient = vi.fn();
const apiClientList = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...a: unknown[]) => apiClient(...a),
  apiClientList: (...a: unknown[]) => apiClientList(...a),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/stores/auth.store', () => ({ useAuthStore: () => ({ user: { role: 'OWNER', permissions: [] } }) }));
vi.mock('@/lib/permissions', () => ({ can: () => true }));

import OpeningBalancesPage from './page';

const acct = (
  account_code: string,
  account_name: string,
  account_class: string,
  normal_balance: 'DEBIT' | 'CREDIT',
  parent_account_code: string | null,
) => ({
  account_code,
  account_name,
  account_class,
  account_type: 'DETAIL' as const,
  parent_account_code,
  normal_balance,
  is_active: true,
});

// A chart with no owner accounts yet: the plug, the two derived accounts, cash,
// and the fixed-asset pair.
const SOLE_OWNER_CHART = [
  acct('1010', 'Cash on Hand', 'ASSET', 'DEBIT', '1000'),
  acct('1310', 'Cold Storage Plant & Equipment', 'ASSET', 'DEBIT', '1300'),
  acct('1311', 'Accum. Depreciation — Plant & Equipment', 'ASSET', 'CREDIT', '1300'),
  acct('3010', 'Opening Balance Equity', 'EQUITY', 'CREDIT', null),
  acct('3020', 'Retained Earnings', 'EQUITY', 'CREDIT', null),
  acct('3030', 'Current Year Profit / (Loss)', 'EQUITY', 'CREDIT', null),
];

const PARTNER_CHART = [...SOLE_OWNER_CHART, acct('3110', 'Junaid — Capital', 'EQUITY', 'CREDIT', '3100')];

const BASE_STATUS = {
  entered: false,
  journal_entry_id: null,
  entry_number: null,
  as_of_date: null,
  earliest_posting_date: null,
  earliest_posting_entry_number: null,
  unattributed_plug_pkr: 0,
};

function mount(status: Record<string, unknown>, chart = SOLE_OWNER_CHART) {
  apiClient.mockReset();
  apiClientList.mockReset();
  apiClientList.mockResolvedValue({ data: [] });
  apiClient.mockImplementation((url: string) => {
    if (url === '/v1/accounting/opening-balances') return Promise.resolve({ ...BASE_STATUS, ...status });
    if (String(url).startsWith('/v1/accounting/accounts')) return Promise.resolve(chart);
    if (String(url).startsWith('/v1/accounting/period-locks')) return Promise.resolve([]);
    return Promise.resolve(null);
  });
  return render(<OpeningBalancesPage />);
}

describe('OpeningBalancesPage — a date after the first posting is impossible', () => {
  beforeEach(() => vi.clearAllMocks());

  // The entry is immutable once posted, so finding out after the form is filled
  // costs a reversal. Same treatment the period lock already gets.
  it('warns before the form is filled, naming the entry in the way', async () => {
    mount({ earliest_posting_date: '2020-01-01', earliest_posting_entry_number: 'JE-000123' });
    await waitFor(() => expect(screen.getByText(/JE-000123/)).toBeTruthy());
    expect(screen.getByText(/Opening balances are the position you started from/)).toBeTruthy();
  });

  it('says nothing on a facility that has never posted', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/Enter what each party owes you/)).toBeTruthy());
    expect(screen.queryByText(/Opening balances are the position you started from/)).toBeNull();
  });
});

describe('OpeningBalancesPage — where equity is meant to go', () => {
  beforeEach(() => vi.clearAllMocks());

  // Unconditional now. While 3010 doubled as a sole proprietor's capital account
  // this screen told them the difference simply posted there and said nothing
  // about attribution — correct then, wrong once the plug is only a plug.
  it('asks for a line per owner, and pre-cutover profit to retained earnings', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/each owner/i)).toBeTruthy());
    // IFRS for SMEs 35.10 — transition adjustments belong in retained earnings,
    // not inside a capital account.
    expect(screen.getByText(/Retained Earnings \(3020\)/)).toBeTruthy();
  });

  it('says the same on a facility that already has partner accounts', async () => {
    mount({}, PARTNER_CHART);
    await waitFor(() => expect(screen.getByText(/each owner/i)).toBeTruthy());
  });
});

describe('OpeningBalancesPage — a residual already posted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('surfaces it on the entered screen, where the form guidance can no longer help', async () => {
    mount(
      {
        entered: true,
        as_of_date: '2026-01-01',
        entry_number: 'JE-000001',
        journal_entry_id: '11111111-1111-1111-1111-111111111111',
        unattributed_plug_pkr: 370000,
      },
      PARTNER_CHART,
    );
    await waitFor(() => expect(screen.getByText(/belongs\s+to no owner/)).toBeTruthy());
    expect(screen.getByText(/370,000/)).toBeTruthy();
  });

  it('stays quiet at zero — attributed in full is not a warning', async () => {
    mount(
      {
        entered: true,
        as_of_date: '2026-01-01',
        entry_number: 'JE-000001',
        journal_entry_id: '11111111-1111-1111-1111-111111111111',
        unattributed_plug_pkr: 0,
      },
      PARTNER_CHART,
    );
    await waitFor(() => expect(screen.getByText(/Opening balances were entered/)).toBeTruthy());
    expect(screen.queryByText(/belongs\s+to no owner/)).toBeNull();
  });
});

/**
 * Depreciation runs off the fixed-asset register, not the ledger
 * (fixed-asset.service.ts). An opening balance keyed straight into 1310 gives
 * the account a balance and the register nothing, so those assets never
 * depreciate and the register never ties back to the GL — silently.
 */
describe('OpeningBalancesPage — fixed assets opened without a register entry', () => {
  beforeEach(() => vi.clearAllMocks());

  /** The last element of a query, asserted present — `at(-1)` is possibly-undefined. */
  const last = <T,>(xs: T[]): T => {
    expect(xs.length).toBeGreaterThan(0);
    return xs[xs.length - 1] as T;
  };

  const addOtherLine = async (code: string, debit: string) => {
    fireEvent.click(await screen.findByRole('button', { name: /add line/i }));
    fireEvent.change(last(screen.getAllByRole('combobox')), { target: { value: code } });
    // The row's debit box: the credit box is the only spinbutton after it.
    const numbers = screen.getAllByRole('spinbutton');
    expect(numbers.length).toBeGreaterThan(1);
    fireEvent.change(numbers[numbers.length - 2] as HTMLElement, { target: { value: debit } });
  };

  it('warns when a cost account is opened directly', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/Enter what each party owes you/)).toBeTruthy());
    await addOtherLine('1310', '200000');
    await waitFor(() => expect(screen.getByText(/will not depreciate/)).toBeTruthy());
  });

  // The contra beside it is CREDIT-normal, so the rule that finds cost accounts
  // (DEBIT-normal detail under header 1300) excludes it without a list of codes.
  it('does not warn for the accumulated-depreciation contra', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/Enter what each party owes you/)).toBeTruthy());
    await addOtherLine('1311', '50000');
    expect(screen.queryByText(/will not depreciate/)).toBeNull();
  });

  it('does not warn for an ordinary asset outside the fixed-asset block', async () => {
    mount({});
    await waitFor(() => expect(screen.getByText(/Enter what each party owes you/)).toBeTruthy());
    await addOtherLine('1010', '12000');
    expect(screen.queryByText(/will not depreciate/)).toBeNull();
  });
});
