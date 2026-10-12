import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/parties/new',
}));

const apiClient = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClient: (...args: unknown[]) => apiClient(...args) };
});

let role = 'OPERATOR';
let permissions: string[] = [];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so useCan's `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PartyForm, type PartyFormValues } from './party-form';

const PARTY_ID = 'party-1';
const STORED: Partial<PartyFormValues> = {
  name: 'Bashir Farms',
  party_type: 'FARMER',
  phone_primary: '0300-1234567',
  credit_limit_pkr: '50000',
  credit_terms_days: '15',
};

function renderForm(props: Partial<React.ComponentProps<typeof PartyForm>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PartyForm mode="edit" partyId={PARTY_ID} initialData={STORED} {...props} />
    </QueryClientProvider>,
  );
}

/** The body of the one save call (POST /v1/parties or PATCH /v1/parties/:id). */
function savedBody(): Record<string, unknown> {
  const call = apiClient.mock.calls.find(
    ([, opts]) => (opts as { method?: string } | undefined)?.method === 'POST' || (opts as { method?: string } | undefined)?.method === 'PATCH',
  );
  expect(call).toBeDefined();
  return (call![1] as { body: Record<string, unknown> }).body;
}

describe('PartyForm credit fields', () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    apiClient.mockImplementation((path: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST' || opts?.method === 'PATCH') return Promise.resolve({ id: PARTY_ID });
      // The parent-arhti picker's search.
      return Promise.resolve([]);
    });
    role = 'OPERATOR';
    permissions = ['parties.manage'];
  });

  it('without parties.credit_terms the credit inputs are read-only, with a hint', () => {
    renderForm();
    const limit = screen.getByLabelText('Credit limit');
    const terms = screen.getByLabelText('Credit terms');
    expect(limit).toBeDisabled();
    expect(terms).toBeDisabled();
    // The stored values still show, so the munshi can see what was set.
    expect(limit).toHaveValue(50000);
    expect(terms).toHaveValue(15);
    expect(screen.getByText('Only a manager can set credit terms.')).toBeInTheDocument();
  });

  it('without parties.credit_terms an edit leaves the credit fields out of the payload', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Name\s*\*$/), { target: { value: 'Bashir Farms & Sons' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/parties/${PARTY_ID}`));
    expect(apiClient).toHaveBeenCalledWith(`/v1/parties/${PARTY_ID}`, expect.objectContaining({ method: 'PATCH' }));
    const body = savedBody();
    expect(body['name']).toBe('Bashir Farms & Sons');
    expect(body).not.toHaveProperty('credit_limit_pkr');
    expect(body).not.toHaveProperty('credit_terms_days');
  });

  it('without parties.credit_terms a new party is created without credit fields', async () => {
    renderForm({ mode: 'create', partyId: undefined, initialData: { name: 'Ali Traders', phone_primary: '0300-7654321' } });
    expect(screen.getByLabelText('Credit limit')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Create Party' }));

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/parties', expect.objectContaining({ method: 'POST' })));
    const body = savedBody();
    expect(body['name']).toBe('Ali Traders');
    expect(body).not.toHaveProperty('credit_limit_pkr');
    expect(body).not.toHaveProperty('credit_terms_days');
  });

  it('with parties.credit_terms the credit inputs are editable and sent', async () => {
    role = 'MANAGER';
    permissions = ['parties.manage', 'parties.credit_terms'];
    renderForm();
    const limit = screen.getByLabelText('Credit limit');
    const terms = screen.getByLabelText('Credit terms');
    expect(limit).toBeEnabled();
    expect(terms).toBeEnabled();
    expect(screen.queryByText('Only a manager can set credit terms.')).toBeNull();

    fireEvent.change(limit, { target: { value: '75000' } });
    fireEvent.change(terms, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/parties/${PARTY_ID}`));
    const body = savedBody();
    expect(body['credit_limit_pkr']).toBe(75000);
    expect(body['credit_terms_days']).toBe(45);
  });

  it('the owner always may set credit terms', async () => {
    role = 'OWNER';
    permissions = [];
    renderForm({ mode: 'create', partyId: undefined, initialData: { name: 'Ali Traders', phone_primary: '0300-7654321' } });
    fireEvent.change(screen.getByLabelText('Credit limit'), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Party' }));

    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/v1/parties', expect.objectContaining({ method: 'POST' })));
    const body = savedBody();
    expect(body['credit_limit_pkr']).toBe(20000);
    // The 30-day default is still sent on create.
    expect(body['credit_terms_days']).toBe(30);
  });
});
