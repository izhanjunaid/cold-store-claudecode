import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: (...a: unknown[]) => apiClient(...a) };
});
import { ApiError } from '@/lib/api-client';

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { id: 'me', role: 'MANAGER', permissions: [] } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CashTodayCard } from './cash-today-card';

const row = (over: Record<string, unknown>) => ({
  user_id: 'u',
  user_name: 'Someone',
  role: 'OPERATOR',
  dispatched: 0,
  cash_collected_pkr: 0,
  other_collected_pkr: 0,
  cheques_count: 0,
  cheques_pkr: 0,
  credit_billed_pkr: 0,
  pending_cash_pkr: 0,
  pending_receipts: 0,
  pending_since: null,
  ...over,
});

const MUNSHI = row({
  user_id: 'munshi',
  user_name: 'Waseem Khan',
  dispatched: 3,
  cash_collected_pkr: 61_500,
  cheques_count: 1,
  cheques_pkr: 9_000,
  credit_billed_pkr: 20_000,
  pending_cash_pkr: 61_500,
  pending_receipts: 3,
  pending_since: '2026-10-18',
});
const ME = row({ user_id: 'me', user_name: 'Shahid Iqbal', pending_cash_pkr: 0 });

let day: Record<string, unknown>;

const posts = () => apiClient.mock.calls.filter(([, o]) => o?.method === 'POST');

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CashTodayCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiClient.mockReset();
  day = { date: '2026-10-19', tracking: true, tracking_from: '2026-10-01', can_count: true, rows: [ME, MUNSHI] };
  apiClient.mockImplementation((_p: string, opts?: { method?: string }) =>
    Promise.resolve(opts?.method === 'POST' ? { handover_number: 'CHO-202610-0001' } : day),
  );
});

describe('CashTodayCard', () => {
  it('shows each collector’s day and the cash still waiting, flagging cash from an earlier day', async () => {
    renderCard();
    const row = (await screen.findByText('Waseem Khan')).closest('tr') as HTMLElement;
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getAllByText(/61,500/).length).toBeGreaterThanOrEqual(2); // taken, and waiting
    expect(within(row).getByText(/1 · Rs\s?9,000/)).toBeInTheDocument();
    expect(within(row).getByText(/since 18 Oct 2026/)).toBeInTheDocument();
  });

  it('a manager counts another collector’s cash, but is not offered their own', async () => {
    day['rows'] = [row({ user_id: 'me', user_name: 'Shahid Iqbal', pending_cash_pkr: 5_000, pending_receipts: 1 }), MUNSHI];
    renderCard();
    const mine = (await screen.findByText('Shahid Iqbal')).closest('tr') as HTMLElement;
    expect(within(mine).queryByRole('button', { name: 'Count cash' })).not.toBeInTheDocument();
    expect(within(mine).getByText('Hand it to a manager')).toBeInTheDocument();
    const theirs = screen.getByText('Waseem Khan').closest('tr') as HTMLElement;
    expect(within(theirs).getByRole('button', { name: 'Count cash' })).toBeInTheDocument();
  });

  it('the munshi sees their own row and no count button', async () => {
    day = { ...day, can_count: false, rows: [MUNSHI] };
    renderCard();
    const r = (await screen.findByText('Waseem Khan')).closest('tr') as HTMLElement;
    expect(within(r).queryByRole('button', { name: 'Count cash' })).not.toBeInTheDocument();
    expect(within(r).getByText('Hand it to a manager')).toBeInTheDocument();
  });

  it('with tracking off it shows the day only, and tells a manager how to switch it on', async () => {
    day = { ...day, tracking: false, tracking_from: null };
    renderCard();
    await screen.findByText('Waseem Khan');
    expect(screen.queryByText('Cash waiting')).not.toBeInTheDocument();
    expect(screen.getByText(/Cash handover is off/)).toBeInTheDocument();
  });

  it('records an exact count with no reason', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Count cash' }));
    fireEvent.change(await screen.findByLabelText(/Cash counted/), { target: { value: '61500' } });
    expect(screen.queryByLabelText(/Why does it differ/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record handover' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![0]).toBe('/v1/cash-handovers');
    expect(posts()[0]![1].body).toEqual({ collector_id: 'munshi', expected_cash_pkr: 61500, counted_cash_pkr: 61500 });
  });

  it('a short count says so and cannot be recorded without its reason', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Count cash' }));
    fireEvent.change(await screen.findByLabelText(/Cash counted/), { target: { value: '61000' } });
    expect(await screen.findByText(/Short by\s+Rs\s?500/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Record handover with difference' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Why does it differ/), { target: { value: 'Torn note discarded' } });
    fireEvent.click(submit);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]![1].body).toEqual({
      collector_id: 'munshi',
      expected_cash_pkr: 61500,
      counted_cash_pkr: 61000,
      variance_reason: 'Torn note discarded',
    });
  });

  it('when the cash waiting changed meanwhile, shows the refusal and the new figure', async () => {
    apiClient.mockImplementation((_p: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') {
        return Promise.reject(
          new ApiError('The cash waiting from this collector is now Rs 70500.00, not the Rs 61500.00 shown — count it again', {
            code: 'HANDOVER_EXPECTED_CHANGED',
            status: 409,
          }),
        );
      }
      return Promise.resolve(day);
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Count cash' }));
    fireEvent.change(await screen.findByLabelText(/Cash counted/), { target: { value: '61500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record handover' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/now Rs 70500\.00/);
  });
});
