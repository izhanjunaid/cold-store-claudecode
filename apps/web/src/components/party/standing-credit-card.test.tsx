import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: (...a: unknown[]) => apiClient(...a) };
});

let role = 'MANAGER';
let permissions: string[] = ['parties.credit_terms'];
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StandingCreditCard } from './standing-credit-card';

const NONE = { approved: false, id: null, max_outstanding_pkr: null, valid_until: null, approved_by_name: null, approved_at: null, note: null };
const APPROVED = {
  approved: true,
  id: 'a1',
  max_outstanding_pkr: 750_000,
  valid_until: '2026-12-31',
  approved_by_name: 'Shahid Iqbal',
  approved_at: '2026-10-19T08:00:00.000Z',
  note: 'Season account',
};

let current: unknown = NONE;
const posts = () => apiClient.mock.calls.filter(([, o]) => o?.method === 'POST');

function renderCard(props: { creditLimitPkr?: number | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StandingCreditCard partyId="p1" partyName="Haji Sahib" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiClient.mockReset();
  role = 'MANAGER';
  permissions = ['parties.credit_terms'];
  current = NONE;
  apiClient.mockImplementation((_path: string, opts?: { method?: string }) =>
    Promise.resolve(opts?.method === 'POST' ? current : current),
  );
});

describe('StandingCreditCard', () => {
  it("a first approval starts from the party's credit limit, and says so", async () => {
    renderCard({ creditLimitPkr: 250_000 });
    await screen.findByText('Not approved'); // the button is disabled while the card loads
    fireEvent.click(screen.getByRole('button', { name: 'Approve credit' }));
    expect(await screen.findByLabelText(/Most the party may owe/)).toHaveValue(250000);
    expect(screen.getByText(/This party's credit limit is Rs\s?250,000/)).toBeInTheDocument();
  });

  it('with no credit limit set, the ceiling starts empty and no limit is mentioned', async () => {
    renderCard({ creditLimitPkr: null });
    await screen.findByText('Not approved'); // the button is disabled while the card loads
    fireEvent.click(screen.getByRole('button', { name: 'Approve credit' }));
    expect(await screen.findByLabelText(/Most the party may owe/)).toHaveValue(null);
    expect(screen.queryByText(/credit limit is/)).not.toBeInTheDocument();
  });

  it('says credit is not approved, and a manager can approve it', async () => {
    renderCard();
    expect(await screen.findByText('Not approved')).toBeInTheDocument();
    expect(screen.getByText(/waits for a manager at the gate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve credit' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('approving sends the ceiling and the date, and nothing for an empty note', async () => {
    renderCard();
    await screen.findByText('Not approved'); // loaded: the button is disabled until then
    fireEvent.click(screen.getByRole('button', { name: 'Approve credit' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    const submit = screen.getAllByRole('button', { name: 'Approve credit' }).at(-1)!;
    expect(submit).toBeDisabled(); // no ceiling yet
    fireEvent.change(screen.getByLabelText(/Most the party may owe/), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2026-12-31' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe('/v1/parties/p1/credit-approval');
    expect(posts()[0]![1].body).toEqual({ max_outstanding_pkr: 500000, valid_until: '2026-12-31' });
  });

  it('shows an approval with its ceiling and date to a manager, who can change or revoke it', async () => {
    current = APPROVED;
    renderCard();
    expect(await screen.findByText('Credit approved')).toBeInTheDocument();
    expect(screen.getByText(/up to Rs\s?750,000 owed in total/)).toBeInTheDocument();
    expect(screen.getByText(/Approved by Shahid Iqbal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });

  it('revoking needs a reason and sends it', async () => {
    current = APPROVED;
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const confirm = await screen.findByRole('button', { name: 'Revoke approval' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Cheque bounced' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe('/v1/parties/p1/credit-approval/revoke');
    expect(posts()[0]![1].body).toEqual({ reason: 'Cheque bounced' });
  });

  it('anyone else sees whether credit is approved — without the ceiling and without buttons', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    current = { ...APPROVED, max_outstanding_pkr: null, note: null };
    renderCard();
    expect(await screen.findByText('Credit approved')).toBeInTheDocument();
    expect(screen.queryByText(/750,000/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve credit|change|revoke/i })).not.toBeInTheDocument();
  });

  it('says so when an approval has lapsed', async () => {
    current = { ...APPROVED, approved: false, valid_until: '2026-09-30' };
    renderCard();
    expect(await screen.findByText('Approval lapsed')).toBeInTheDocument();
    expect(screen.getByText(/ended/)).toBeInTheDocument();
  });
});
