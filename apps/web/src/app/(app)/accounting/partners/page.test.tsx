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
    capital_account_code: '3120',
    capital_account_name: 'Umair — Capital',
    drawings_account_code: '3220',
    drawings_account_name: 'Umair — Drawings',
    admitted_on: '2026-01-01',
    retired_on: null,
  },
];

function mount(partners = PARTNERS, windows: unknown[] = []) {
  apiClient.mockReset();
  apiClient.mockImplementation((url: string) => {
    if (url === '/v1/partners') return Promise.resolve(partners);
    if (url === '/v1/partners/profit-shares') return Promise.resolve(windows);
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
    await waitFor(() => expect(screen.getByText('3110')).toBeTruthy());
    // Both sides, together — the pairing nothing used to record.
    expect(screen.getAllByText('Junaid').length).toBeGreaterThan(0);
    expect(screen.getByText('3210')).toBeTruthy();
  });

  it('promises both accounts when adding, so no code has to be invented', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('3110')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /add owner/i }));
    await waitFor(() => expect(screen.getByText(/Two accounts are opened for them/)).toBeTruthy());
    expect(screen.getByText(/You never have to choose a code/)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('3110')).toBeTruthy());
    expect(screen.getByText(/gives partners equal shares unless they agree otherwise/)).toBeTruthy();

    const weightFor = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
    expect(weightFor('Junaid').value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: /equal shares/i }));
    await waitFor(() => expect(weightFor('Junaid').value).toBe('1'));
    expect(weightFor('Umair').value).toBe('1');
  });

  it('sends weights and the date the ratio takes effect', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('3110')).toBeTruthy());
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

  it('hides the controls from someone without the permission', async () => {
    role = 'ACCOUNTANT';
    mount();
    await waitFor(() => expect(screen.getByText('3110')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /add owner/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save ratio/i })).toBeNull();
  });
});
