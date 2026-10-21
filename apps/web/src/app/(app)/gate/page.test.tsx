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

  it('shows the raw outbound event ID box to managers only', async () => {
    const guardDialog = await openClearOutward();
    expect(within(guardDialog).queryByLabelText(/outbound event id/i)).not.toBeInTheDocument();
  });

  it('lets a manager send an outbound event ID with the count', async () => {
    role = 'MANAGER';
    const dialog = await openClearOutward();
    const id = '0b6f3c1e-8f2a-4d6b-9a51-2c7e5d4f1a90';
    fireEvent.change(within(dialog).getByLabelText(/outbound event id/i), { target: { value: id } });
    enterCount(dialog, '20');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    await waitFor(() => expect(outwardPosts()).toHaveLength(1));
    expect(outwardPosts()[0]![1].body).toEqual({ outbound_event_id: id, declared_quantity: 20 });
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

  it('shows the server message when payment is pending', async () => {
    apiClient.mockRejectedValueOnce(
      new ApiError('Payment Pending — balance 4500.00 PKR', { code: 'GATE_OUTWARD_BLOCKED', status: 422 }),
    );
    const dialog = await openClearOutward();
    enterCount(dialog, '137');
    fireEvent.click(within(dialog).getByRole('button', { name: /^clear outward$/i }));

    expect(await within(dialog).findByText(/balance 4500\.00 PKR/)).toBeInTheDocument();
    expect(within(dialog).getByText(/escalate to manager/i)).toBeInTheDocument();
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

  it('tells the guard why a truck cannot leave yet', async () => {
    listWith(READY, OWES);
    render(<GatePassConsolePage />);
    expect(await screen.findByText(/Payment pending — Rs 4,500 \(cheque not cleared\)/)).toBeInTheDocument();
    expect(screen.getByText('Paid — ready to leave')).toBeInTheDocument();
  });

  it('the guard gets no amount (the API sends null): the badge sends the driver to the desk instead', async () => {
    listWith(READY, { ...OWES, release: { ...OWES.release, outstanding_pkr: null } });
    render(<GatePassConsolePage />);
    expect(await screen.findByText('Payment pending — send the driver to the desk (cheque not cleared)')).toBeInTheDocument();
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
