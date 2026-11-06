import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, back: vi.fn() }),
  usePathname: () => '/gate',
}));

// Keep the real ApiError so the page's `instanceof` / `.code` checks see what the API throws.
const apiClient = vi.fn();
const apiClientList = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return {
    ...actual,
    apiClient: (...args: unknown[]) => apiClient(...args),
    apiClientList: (...args: unknown[]) => apiClientList(...args),
  };
});
import { ApiError } from '@/lib/api-client';

let role = 'SECURITY';
let permissions: string[] = ['gate_passes.log'];
vi.mock('@/stores/auth.store', () => ({
  // Honour the selector so `useAuthStore((s) => s.user)` works.
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));

// "Today" is pinned far from the real date, so the test proves the page asks
// localIsoDate() (the viewer's day) rather than slicing a UTC timestamp.
vi.mock('@coldchain/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coldchain/shared')>();
  return { ...actual, localIsoDate: () => '2031-01-15' };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import GatePassConsolePage from './page';

const PASS = {
  id: 'pass-1',
  pass_number: 'GP-0001',
  vehicle_number: 'LHR-1234',
  driver_name: 'Ali Khan',
  status: 'ARRIVED',
  related_lot_number: null,
  related_outbound_id: null,
  related_dispatch_note_number: 'DN-0007',
  // What was dispatched. The guard's count is blind: this must never reach the screen.
  authorized_quantity: 137,
  declared_quantity: null,
  created_at: new Date().toISOString(),
  turnaround_seconds: null,
};

const CLEARED = { ...PASS, status: 'CLEARED', turnaround_seconds: 600 };

beforeEach(() => {
  replace.mockReset();
  apiClient.mockReset();
  apiClientList.mockReset();
  role = 'SECURITY';
  permissions = ['gate_passes.log'];
  apiClientList.mockImplementation((path: string) =>
    Promise.resolve({
      data: path.includes('active=true') ? [PASS] : [],
      meta: { page: 1, per_page: 50, total: 1 },
    }),
  );
  apiClient.mockResolvedValue(CLEARED);
});

async function openClearOutward() {
  render(<GatePassConsolePage />);
  fireEvent.click(await screen.findByRole('button', { name: /^clear outward$/i }));
  return screen.findByRole('dialog');
}

function enterCount(dialog: HTMLElement, value: string) {
  fireEvent.change(within(dialog).getByLabelText(/bags counted on truck/i), { target: { value } });
}

const outwardPosts = () =>
  apiClient.mock.calls.filter(([path, opts]) => path === `/v1/gate-passes/${PASS.id}/outward` && opts?.method === 'POST');

describe('GatePassConsolePage — access', () => {
  it('shows the access message and sends the user to the dashboard without gate_passes.log', async () => {
    role = 'OPERATOR';
    permissions = ['lots.manage'];
    render(<GatePassConsolePage />);

    expect(screen.getByText(/gate pass access required/i)).toBeInTheDocument();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
    expect(apiClientList).not.toHaveBeenCalled();
  });

  it('lists the vehicles inside, and today’s clearances by the local date, with gate_passes.log', async () => {
    render(<GatePassConsolePage />);

    expect(await screen.findByText('LHR-1234')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(apiClientList).toHaveBeenCalledWith(expect.stringContaining('status=CLEARED&date_from=2031-01-15'));
  });
});

describe('GatePassConsolePage — clear outward', () => {
  it('needs a bag count before clearing and sends it as declared_quantity', async () => {
    const dialog = await openClearOutward();
    const clear = within(dialog).getByRole('button', { name: /^clear outward$/i });

    expect(within(dialog).getByText(/enter 0 for an empty truck/i)).toBeInTheDocument();
    expect(clear).toBeDisabled();

    // 0 is a real answer (an empty truck), not "nothing entered".
    enterCount(dialog, '0');
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    await waitFor(() => expect(outwardPosts()).toHaveLength(1));
    expect(outwardPosts()[0]![1].body).toEqual({ declared_quantity: 0 });
  });

  it('never shows the expected bag count', async () => {
    const dialog = await openClearOutward();
    enterCount(dialog, '12');

    expect(screen.queryByText(/137/)).not.toBeInTheDocument();
    expect(within(dialog).queryByDisplayValue('137')).not.toBeInTheDocument();
  });

  // C3 D9: a manager names a withdrawal by its dispatch note number, not a raw id. The search route is a
  // substring match, so only the exact dispatch note counts.
  describe('the dispatch note box (managers only)', () => {
    const DN = 'DN-260101-0009';
    const withdrawal = (over: Record<string, unknown> = {}) => ({
      id: 'ob-9',
      dispatch_note_number: DN,
      status: 'DISPATCHED',
      vehicle_number: 'LHR-1234',
      lot_number: 'LOT-260101-0001',
      marka: 'AH',
      owner_party_name: 'Haji Sahib',
      gate_pass_id: null,
      ...over,
    });
    const lookupReturns = (rows: unknown[], pass: Record<string, unknown> = PASS) =>
      apiClientList.mockImplementation((path: string) =>
        Promise.resolve({
          data: path.startsWith('/v1/outbound-events') ? rows : path.includes('active=true') ? [pass] : [],
          meta: { page: 1, per_page: 50, total: 1 },
        }),
      );
    const lookups = () => apiClientList.mock.calls.filter(([p]) => String(p).startsWith('/v1/outbound-events'));
    const box = (dialog: HTMLElement) => within(dialog).getByLabelText(/dispatch note number/i);
    const find = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: /^find$/i }));
    const clear = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: /^clear outward$/i });

    beforeEach(() => {
      role = 'MANAGER';
    });

    it('is not shown to the guard', async () => {
      role = 'SECURITY';
      const dialog = await openClearOutward();
      expect(within(dialog).queryByLabelText(/dispatch note number/i)).not.toBeInTheDocument();
      expect(within(dialog).queryByLabelText(/outbound event id/i)).not.toBeInTheDocument();
    });

    it('finds a withdrawal by its dispatch note and releases it by that note', async () => {
      lookupReturns([withdrawal()]);
      const dialog = await openClearOutward();
      fireEvent.change(box(dialog), { target: { value: ' dn-260101-0009 ' } });
      find(dialog);

      expect(await within(dialog).findByText(/Haji Sahib/)).toHaveTextContent(`${DN} · Haji Sahib · AH · LHR-1234`);
      expect(lookups()[0]![0]).toBe(`/v1/outbound-events?status=DISPATCHED&search=${DN}&page_size=10`);
      enterCount(dialog, '20');
      fireEvent.click(clear(dialog));

      await waitFor(() => expect(outwardPosts()).toHaveLength(1));
      expect(outwardPosts()[0]![1].body).toEqual({ outbound_event_id: 'ob-9', declared_quantity: 20 });
    });

    it('Enter in the box looks the note up and releases nothing', async () => {
      lookupReturns([withdrawal()]);
      const dialog = await openClearOutward();
      enterCount(dialog, '20');
      fireEvent.change(box(dialog), { target: { value: DN } });
      fireEvent.keyDown(box(dialog), { key: 'Enter' });

      await within(dialog).findByText(/Haji Sahib/);
      expect(lookups()).toHaveLength(1);
      expect(outwardPosts()).toHaveLength(0);
    });

    it('does not pick a near miss: DN-…-0009 is not DN-…-00090', async () => {
      lookupReturns([withdrawal({ id: 'ob-90', dispatch_note_number: `${DN}0` })]);
      const dialog = await openClearOutward();
      fireEvent.change(box(dialog), { target: { value: DN } });
      find(dialog);

      expect(await within(dialog).findByText('No dispatched withdrawal with that dispatch note number.')).toBeInTheDocument();
      enterCount(dialog, '20');
      expect(clear(dialog)).toBeDisabled();
    });

    it('refuses a dispatch note that already left on another truck', async () => {
      lookupReturns([withdrawal({ gate_pass_id: 'gp-other' })]);
      const dialog = await openClearOutward();
      fireEvent.change(box(dialog), { target: { value: DN } });
      find(dialog);

      expect(await within(dialog).findByText('That dispatch note already left on another truck.')).toBeInTheDocument();
      enterCount(dialog, '20');
      expect(clear(dialog)).toBeDisabled();
    });

    it('holds Clear Outward while a typed note has not been found, and again once it is edited', async () => {
      lookupReturns([withdrawal()]);
      const dialog = await openClearOutward();
      enterCount(dialog, '20');
      expect(clear(dialog)).toBeEnabled(); // nothing typed: match the truck by its plate as before

      fireEvent.change(box(dialog), { target: { value: 'DN-260101-0' } });
      expect(within(dialog).getByText('Find the dispatch note, or clear the box.')).toBeInTheDocument();
      expect(clear(dialog)).toBeDisabled();

      fireEvent.change(box(dialog), { target: { value: DN } });
      find(dialog);
      await within(dialog).findByText(/Haji Sahib/);
      expect(clear(dialog)).toBeEnabled();

      fireEvent.change(box(dialog), { target: { value: `${DN}1` } }); // edited after the match: it no longer applies
      expect(clear(dialog)).toBeDisabled();
      fireEvent.change(box(dialog), { target: { value: '' } });
      expect(clear(dialog)).toBeEnabled();
    });

    it('shows a failed lookup instead of releasing anything', async () => {
      apiClientList.mockImplementation((path: string) =>
        path.startsWith('/v1/outbound-events')
          ? Promise.reject(new ApiError('Missing permission: outbound.record', { code: 'FORBIDDEN', status: 403 }))
          : Promise.resolve({ data: path.includes('active=true') ? [PASS] : [], meta: { page: 1, per_page: 50, total: 1 } }),
      );
      const dialog = await openClearOutward();
      fireEvent.change(box(dialog), { target: { value: DN } });
      find(dialog);

      expect(await within(dialog).findByText('Missing permission: outbound.record')).toBeInTheDocument();
      enterCount(dialog, '20');
      expect(clear(dialog)).toBeDisabled();
    });

    it("a pass's stored link is never sent as the manager's choice", async () => {
      lookupReturns([], { ...PASS, related_outbound_id: 'ob-9' });
      const dialog = await openClearOutward();
      expect(box(dialog)).toHaveValue('');
      enterCount(dialog, '5');
      fireEvent.click(clear(dialog));

      await waitFor(() => expect(outwardPosts()).toHaveLength(1));
      expect(outwardPosts()[0]![1].body).toEqual({ declared_quantity: 5 });
    });
  });

  it('on a count mismatch a manager gives a reason and releases anyway', async () => {
    role = 'MANAGER';
    apiClient.mockRejectedValueOnce(
      new ApiError('The bag count does not match the dispatch', {
        code: 'GATE_OUTWARD_COUNT_MISMATCH',
        status: 422,
      }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    const reason = await within(dialog).findByLabelText(/override reason/i);
    const release = within(dialog).getByRole('button', { name: /release anyway/i });
    expect(release).toBeDisabled();

    fireEvent.change(reason, { target: { value: 'ok' } });
    expect(release).toBeDisabled();
    fireEvent.change(reason, { target: { value: '  Seven bags torn, kept back  ' } });
    expect(release).toBeEnabled();
    fireEvent.click(release);

    await waitFor(() => expect(outwardPosts()).toHaveLength(2));
    expect(outwardPosts()[1]![1].body).toEqual({
      declared_quantity: 130,
      override_reason: 'Seven bags torn, kept back',
    });
    expect(screen.queryByText(/137/)).not.toBeInTheDocument();
  });

  it('a locked truck is not listed as ready to leave: the guard is told to call a manager', async () => {
    const LOCKED = {
      ...PASS,
      vehicle_number: 'LHR-4444',
      release: { state: 'COUNT_LOCKED' as const, dispatch_notes: ['DN-260101-0011'], outstanding_pkr: null, cheque_pending: false, marka: null, owner_party_name: null },
    };
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve({ data: path.includes('active=true') ? [LOCKED] : [], meta: { page: 1, per_page: 50, total: 1 } }),
    );
    render(<GatePassConsolePage />);
    expect(await screen.findByText(/Counts did not match — call a manager/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^release$/i })).not.toBeInTheDocument();
  });

  it('a plate override that then hits a payment block keeps its reason when the manager adds credit', async () => {
    role = 'MANAGER';
    apiClient
      .mockRejectedValueOnce(
        new ApiError('plate mismatch', { code: 'GATE_OUTWARD_PLATE_MISMATCH', status: 422 }),
      )
      .mockRejectedValueOnce(
        new ApiError('Payment Pending — balance 4500.00 PKR', { code: 'GATE_OUTWARD_BLOCKED', status: 422 }),
      );
    const dialog = await openClearOutward();
    enterCount(dialog, '20');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    fireEvent.change(await within(dialog).findByLabelText(/override reason/i), {
      target: { value: 'Truck swapped after breakdown' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /release anyway/i }));

    // Payment now blocks it: the reason box stays, and the next try — with credit
    // ticked, from the main button — still carries the reason.
    await within(dialog).findByText(/Payment Pending/);
    expect(within(dialog).getByLabelText(/override reason/i)).toHaveValue('Truck swapped after breakdown');
    fireEvent.click(within(dialog).getByLabelText(/authorize on credit/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    await waitFor(() => expect(outwardPosts()).toHaveLength(3));
    expect(outwardPosts()[2]![1].body).toEqual({
      declared_quantity: 20,
      credit_authorization: true,
      override_reason: 'Truck swapped after breakdown',
    });
  });

  it('a guard never names a withdrawal, even when the pass carries a link', async () => {
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes('active=true') ? [{ ...PASS, related_outbound_id: 'ob-9' }] : [],
        meta: { page: 1, per_page: 50, total: 1 },
      }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '5');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    await waitFor(() => expect(outwardPosts()).toHaveLength(1));
    expect(outwardPosts()[0]![1].body).toEqual({ declared_quantity: 5 });
  });

  it('on a count mismatch a guard is told to recount and gets no override', async () => {
    apiClient.mockRejectedValueOnce(
      new ApiError('The bag count does not match the dispatch', {
        code: 'GATE_OUTWARD_COUNT_MISMATCH',
        status: 422,
      }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText('Recount, or call a manager.')).toBeInTheDocument();
    // Said once: the server states the fact, the page gives the guard their next step.
    expect(within(dialog).getAllByText(/call a manager/i)).toHaveLength(1);
    expect(within(dialog).getByText(/does not match the dispatch/i)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/override reason/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /release anyway/i })).not.toBeInTheDocument();
  });

  // C3 D4: each wrong count is saved and three lock the truck. What the guard hears is how many tries are
  // left, from the error's details (the API's `error.details`), never what the count should have been.
  const withTries = (message: string, code: string, status: number, triesLeft: number) =>
    new ApiError(message, { code, status, details: { code, message, details: { tries_left: triesLeft } } });

  it('a wrong count tells the guard which try it was', async () => {
    apiClient.mockRejectedValueOnce(
      withTries('The bag count does not match the dispatch', 'GATE_OUTWARD_COUNT_MISMATCH', 422, 2),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText('Try 1 of 3, recount.')).toBeInTheDocument();
    expect(within(dialog).queryByText('Recount, or call a manager.')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/override reason/i)).not.toBeInTheDocument();
  });

  it('the last wrong count tells the guard to call a manager', async () => {
    apiClient.mockRejectedValueOnce(
      withTries('The bag count does not match the dispatch', 'GATE_OUTWARD_COUNT_MISMATCH', 422, 0),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText('Try 3 of 3 — call a manager.')).toBeInTheDocument();
  });

  it('a locked truck tells the guard to call a manager, and the guard cannot try again', async () => {
    apiClient.mockRejectedValueOnce(
      new ApiError('The bag count did not match 3 times — a manager must release this truck', {
        code: 'GATE_OUTWARD_COUNT_LOCKED',
        status: 403,
      }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '50');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText(/did not match 3 times/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/call a manager/i)).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: /^clear outward$/i })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /release anyway/i })).not.toBeInTheDocument();
  });

  it('a manager sees the earlier counts on the pass; the guard sees none of them', async () => {
    const attempts = [
      { declared_quantity: 41, expected_quantity: 50, counted_by_name: 'Bilal', created_at: new Date().toISOString() },
      { declared_quantity: 44, expected_quantity: 50, counted_by_name: 'Imran', created_at: new Date().toISOString() },
    ];
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes('active=true') ? [{ ...PASS, count_attempts: attempts }] : [],
        meta: { page: 1, per_page: 50, total: 1 },
      }),
    );
    role = 'MANAGER';
    const managerDialog = await openClearOutward();
    expect(within(managerDialog).getByText(/earlier counts/i)).toBeInTheDocument();
    expect(within(managerDialog).getByText(/Bilal counted 41, dispatch said 50/)).toBeInTheDocument();
    expect(within(managerDialog).getByText(/Imran counted 44, dispatch said 50/)).toBeInTheDocument();
  });

  it('the guard is not shown the earlier counts, nor what was expected', async () => {
    const attempts = [{ declared_quantity: 41, expected_quantity: null, counted_by_name: 'Bilal', created_at: new Date().toISOString() }];
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve({
        data: path.includes('active=true') ? [{ ...PASS, count_attempts: attempts }] : [],
        meta: { page: 1, per_page: 50, total: 1 },
      }),
    );
    const dialog = await openClearOutward();
    expect(within(dialog).queryByText(/earlier counts/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Bilal/)).not.toBeInTheDocument();
  });

  // C3 D3: a truck with a booking not yet checked out leaves by the desk, never by an override.
  const NOT_DISPATCHED = 'Withdrawal DN-260101-0009 has not been dispatched — it cannot leave yet';

  it('sends a truck with a booked line back to the desk, with no recount and no override', async () => {
    apiClient.mockRejectedValueOnce(new ApiError(NOT_DISPATCHED, { code: 'GATE_OUTWARD_NOT_DISPATCHED', status: 422 }));
    const dialog = await openClearOutward();
    enterCount(dialog, '0');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText(/has not been dispatched/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Send the truck back to the desk.')).toBeInTheDocument();
    expect(within(dialog).queryByText(/recount/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /release anyway/i })).not.toBeInTheDocument();
  });

  it('a manager who was offered Release anyway for the count loses it once a booked line holds the truck', async () => {
    role = 'MANAGER';
    apiClient
      .mockRejectedValueOnce(new ApiError('The bag count does not match the dispatch', { code: 'GATE_OUTWARD_COUNT_MISMATCH', status: 422 }))
      .mockRejectedValueOnce(new ApiError(NOT_DISPATCHED, { code: 'GATE_OUTWARD_NOT_DISPATCHED', status: 422 }));
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    await within(dialog).findByRole('button', { name: /release anyway/i });

    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    expect(await within(dialog).findByText(/has not been dispatched/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Send the truck back to the desk.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /release anyway/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/override reason/i)).not.toBeInTheDocument();
  });

  it('shows the server message when payment is pending, with one next step for the guard', async () => {
    // What the API really tells the guard: the fact, no amount (managers hear the balance).
    apiClient.mockRejectedValueOnce(new ApiError('Payment pending', { code: 'GATE_OUTWARD_BLOCKED', status: 422 }));
    const dialog = await openClearOutward();
    enterCount(dialog, '137');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText('Payment pending')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/escalate to manager|send the driver|call a manager/i)).toHaveLength(1);
    expect(within(dialog).queryByText(/Rs\s|PKR/)).not.toBeInTheDocument();
  });

  it('after a refused release, Cancel closes the dialog', async () => {
    apiClient.mockRejectedValueOnce(new ApiError('Payment pending', { code: 'GATE_OUTWARD_BLOCKED', status: 422 }));
    const dialog = await openClearOutward();
    enterCount(dialog, '20');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    await within(dialog).findByText('Payment pending');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server message for a release the gate cannot override', async () => {
    apiClient.mockRejectedValueOnce(
      new ApiError('You booked or dispatched a withdrawal on this truck — someone else must release it', {
        code: 'GATE_SELF_RELEASE',
        status: 403,
      }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '137');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText(/someone else must release it/i)).toBeInTheDocument();
    expect(within(dialog).queryByText('Recount, or call a manager.')).not.toBeInTheDocument();
  });

  it('starts each pass with an empty count and no override', async () => {
    role = 'MANAGER';
    apiClient.mockRejectedValueOnce(
      new ApiError('mismatch', { code: 'GATE_OUTWARD_COUNT_MISMATCH', status: 422 }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '130');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));
    fireEvent.change(await within(dialog).findByLabelText(/override reason/i), { target: { value: 'Torn bags' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^clear outward$/i }));

    const reopened = await screen.findByRole('dialog');
    expect(within(reopened).getByLabelText(/bags counted on truck/i)).toHaveValue(null);
    expect(within(reopened).queryByLabelText(/override reason/i)).not.toBeInTheDocument();
    expect(within(reopened).getByRole('button', { name: /^clear outward$/i })).toBeDisabled();
  });
});

describe('Ready to leave', () => {
  const READY = {
    ...PASS,
    id: 'pass-ready',
    vehicle_number: 'LHR-7777',
    release: {
      state: 'READY' as const,
      dispatch_notes: ['DN-260101-0009'],
      outstanding_pkr: 0,
      cheque_pending: false,
      marka: 'AH',
      owner_party_name: 'Haji Sahib',
    },
  };
  const OWES = {
    ...PASS,
    id: 'pass-owes',
    vehicle_number: 'LHR-8888',
    release: {
      state: 'PAYMENT_PENDING' as const,
      dispatch_notes: ['DN-260101-0010'],
      outstanding_pkr: 4500,
      cheque_pending: true,
      marka: null,
      owner_party_name: 'Other Party',
    },
  };

  function listWith(...passes: unknown[]) {
    apiClientList.mockImplementation((path: string) =>
      Promise.resolve({ data: path.includes('active=true') ? passes : [], meta: { page: 1, per_page: 50, total: passes.length } }),
    );
  }

  it('lists only paid trucks under Ready to leave, with owner, marka and dispatch note', async () => {
    listWith(READY, OWES);
    render(<GatePassConsolePage />);
    const card = (await screen.findByText('Ready to leave')).closest('div[class*="border-green"]') as HTMLElement;
    expect(within(card).getByText('LHR-7777')).toBeInTheDocument();
    expect(within(card).getByText(/Haji Sahib/)).toBeInTheDocument();
    expect(within(card).getByText(/Marka: AH/)).toBeInTheDocument();
    expect(within(card).getByText(/DN-260101-0009/)).toBeInTheDocument();
    expect(within(card).queryByText('LHR-8888')).not.toBeInTheDocument();
  });

  it('a truck carrying several owners\' lots lists each withdrawal with its own marka and owner', async () => {
    listWith({
      ...READY,
      release: {
        ...READY.release,
        dispatch_notes: ['DN-260101-0009', 'DN-260101-0011'],
        withdrawals: [
          { dispatch_note_number: 'DN-260101-0009', marka: 'AH', owner_party_name: 'Haji Sahib' },
          { dispatch_note_number: 'DN-260101-0011', marka: 'BF', owner_party_name: 'Bashir' },
        ],
      },
    });
    render(<GatePassConsolePage />);
    const card = (await screen.findByText('Ready to leave')).closest('div[class*="border-green"]') as HTMLElement;
    expect(within(card).getByText(/Marka: AH/)).toBeInTheDocument();
    expect(within(card).getByText(/Marka: BF/)).toBeInTheDocument();
    expect(within(card).getByText(/Bashir/)).toBeInTheDocument();
    expect(within(card).getByText(/DN-260101-0011/)).toBeInTheDocument();
  });

  it('tells the guard why a truck cannot leave yet', async () => {
    listWith(READY, OWES);
    render(<GatePassConsolePage />);
    expect(await screen.findByText(/Payment pending — Rs 4,500 \(cheque not cleared\)/)).toBeInTheDocument();
    expect(screen.getByText('Paid — ready to leave')).toBeInTheDocument();
  });

  it('the guard gets no amount (the API sends null): the badge states the fact without one', async () => {
    listWith(READY, { ...OWES, release: { ...OWES.release, outstanding_pkr: null } });
    render(<GatePassConsolePage />);
    expect(await screen.findByText('Payment pending (cheque not cleared)')).toBeInTheDocument();
    expect(screen.queryByText(/Rs\s/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN|null/)).not.toBeInTheDocument();
  });
  it('a truck leaving on a standing credit approval is READY and says so — no amount, no ceiling', async () => {
    listWith({ ...READY, release: { ...READY.release, outstanding_pkr: 48_000, on_credit: true } });
    render(<GatePassConsolePage />);
    const card = (await screen.findByText('Ready to leave')).closest('div[class*="border-green"]') as HTMLElement;
    expect(within(card).getByText('LHR-7777')).toBeInTheDocument();
    expect(screen.getByText('Credit approved — ready to leave')).toBeInTheDocument();
    expect(screen.queryByText('Paid — ready to leave')).not.toBeInTheDocument();
    expect(screen.queryByText(/48,000/)).not.toBeInTheDocument();
  });

  it('Release opens the same blind count dialog, and shows no expected count', async () => {
    listWith({ ...READY, authorized_quantity: 137 });
    render(<GatePassConsolePage />);
    fireEvent.click(await screen.findByRole('button', { name: /^release$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/bags counted/i)).toBeInTheDocument();
    expect(screen.queryByText(/137/)).not.toBeInTheDocument();
  });

  it('shows no Ready to leave card when nothing is ready', async () => {
    listWith(OWES);
    render(<GatePassConsolePage />);
    await screen.findByText('LHR-8888');
    expect(screen.queryByText('Ready to leave')).not.toBeInTheDocument();
  });
});
