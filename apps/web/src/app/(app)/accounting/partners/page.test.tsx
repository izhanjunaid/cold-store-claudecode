import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/accounting/partners',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let role = 'OWNER';
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: () => ({ user: { role, permissions: [] } }),
}));
vi.mock('@/lib/permissions', () => ({ can: () => role === 'OWNER' }));

import PartnersPage from './page';

const PARTNERS = [
  {
    id: 'p-junaid',
    name: 'Junaid',
    cnic: null,
    capital_account_code: '3110',
    capital_account_name: 'Junaid — Capital',
    drawings_account_code: '3210',
    drawings_account_name: 'Junaid — Drawings',
    admitted_on: '2026-01-01',
    retired_on: null,
  },
  {
    id: 'p-umair',
    name: 'Umair',
    cnic: null,
    capital_account_code: '3120',
    capital_account_name: 'Umair — Capital',
    drawings_account_code: '3220',
    drawings_account_name: 'Umair — Drawings',
    admitted_on: '2026-01-01',
    retired_on: null,
  },
];

const EQUITY_ACCOUNTS = [
  { account_code: '3010', account_name: 'Opening Balance Equity', account_type: 'DETAIL', normal_balance: 'CREDIT' },
  { account_code: '3015', account_name: 'Owner Drawings (legacy)', account_type: 'DETAIL', normal_balance: 'DEBIT' },
  { account_code: '3110', account_name: 'Junaid — Capital', account_type: 'DETAIL', normal_balance: 'CREDIT' },
];

function mount(partners = PARTNERS, windows: unknown[] = [], unattributed = 0) {
  apiClient.mockReset();
  apiClient.mockImplementation((url: string) => {
    if (url === '/v1/partners') return Promise.resolve(partners);
    if (url === '/v1/partners/profit-shares') return Promise.resolve(windows);
    if (String(url).startsWith('/v1/accounting/accounts')) return Promise.resolve(EQUITY_ACCOUNTS);
    if (url === '/v1/accounting/opening-balances') return Promise.resolve({ unattributed_plug_pkr: unattributed });
    return Promise.resolve({});
  });
  return render(<PartnersPage />);
}

describe('PartnersPage — an owner is a record, with both their accounts', () => {
  beforeEach(() => {
    role = 'OWNER';
    vi.clearAllMocks();
  });

  it('shows each owner with the two accounts that are theirs', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    // Both sides, together — the pairing nothing used to record.
    expect(screen.getAllByText('Junaid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3210').length).toBeGreaterThan(0);
  });

  it('promises both accounts when adding, so no code has to be invented', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }));
    await waitFor(() => expect(screen.getByText(/capital and drawings accounts are opened for them/)).toBeTruthy());
    expect(screen.getByText(/you never have to choose one/)).toBeTruthy();
  });

  it('names the empty state after the defect it prevents', async () => {
    mount([]);
    await waitFor(() => expect(screen.getByText(/No owners recorded yet/)).toBeTruthy());
    expect(screen.getByText(/only one of the two/)).toBeTruthy();
  });

  // Partnership Act 1932 s.13(b). Offered as a button, never applied on load —
  // the owners have to choose it.
  it('offers equal shares rather than assuming them', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    expect(screen.getByText(/gives partners equal shares unless they agree otherwise/)).toBeTruthy();

    const weightFor = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
    expect(weightFor('Junaid').value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /equal shares/i }));
    await waitFor(() => expect(weightFor('Junaid').value).toBe('1'));
    expect(weightFor('Umair').value).toBe('1');
  });

  it('sends weights and the date the ratio takes effect', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Junaid'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Umair'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/effective from/i), { target: { value: '2026-07-01' } });
    fireEvent.click(screen.getByRole('button', { name: /save ratio/i }));

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/partners/profit-shares', {
        method: 'PUT',
        body: {
          effective_from: '2026-07-01',
          shares: [
            { partner_id: 'p-junaid', weight: 3 },
            { partner_id: 'p-umair', weight: 1 },
          ],
        },
      }),
    );
  });

  it('shows each recorded ratio as a percentage, with the date it applies from', async () => {
    mount(PARTNERS, [
      {
        effective_from: '2026-07-01',
        shares: [
          { partner_id: 'p-junaid', partner_name: 'Junaid', weight: 3, share_pct: 75 },
          { partner_id: 'p-umair', partner_name: 'Umair', weight: 1, share_pct: 25 },
        ],
      },
    ]);
    await waitFor(() => expect(screen.getByText(/Junaid 75% · Umair 25%/)).toBeTruthy());
  });

  it('offers unclaimed accounts for adoption, but never the opening-balance plug', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }));
    await waitFor(() => expect(screen.getByLabelText(/existing drawings account/i)).toBeTruthy());
    expect(screen.getByRole('option', { name: /3015 — Owner Drawings/ })).toBeTruthy();
    // Junaid's own capital is claimed; the plug belongs to nobody.
    expect(screen.queryByRole('option', { name: /3110 — Junaid/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Opening Balance Equity/ })).toBeNull();
  });

  it('records a CNIC and a retirement through Edit', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(await screen.findByLabelText('CNIC'), { target: { value: '35202-1234567-1' } });
    fireEvent.change(screen.getByLabelText(/retired on/i), { target: { value: '2026-06-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/partners/p-junaid', {
        method: 'PATCH',
        body: { name: 'Junaid', cnic: '35202-1234567-1', retired_on: '2026-06-30' },
      }),
    );
  });

  it('attributes unattributed opening equity to an owner in one step (L-32)', async () => {
    mount(PARTNERS, [], 370000);
    await waitFor(() => expect(screen.getByText(/belongs to\s+no owner yet/)).toBeTruthy());
    fireEvent.click(screen.getAllByRole('button', { name: /attribute opening equity/i })[0]!);
    fireEvent.change(await screen.findByLabelText(/amount/i), { target: { value: '185000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attribute' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/v1/partners/p-junaid/attribute-opening-equity',
        expect.objectContaining({ method: 'POST', body: expect.objectContaining({ amount_pkr: 185000 }) }),
      ),
    );
  });

  it('hides the controls from someone without the permission', async () => {
    role = 'ACCOUNTANT';
    mount();
    await waitFor(() => expect(screen.getAllByText('3110').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /add owner/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save ratio/i })).toBeNull();
  });
});
