import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));

const apiClientList = vi.fn();
vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>();
  return { ...actual, apiClientList: (...args: unknown[]) => apiClientList(...args) };
});

let role = 'MANAGER';
let permissions: string[] = ['outbound.record', 'outbound.finalize', 'invoices.manage'];
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: { role, permissions } };
    return selector ? selector(state) : state;
  },
}));
vi.mock('@/stores/ui.store', () => ({ useUiStore: () => ({ sidebarCollapsed: false, toggleSidebar: vi.fn() }) }));

import { Sidebar } from './sidebar';

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Sidebar />
    </QueryClientProvider>,
  );
}

const waiting = (total: number) => Promise.resolve({ data: [], meta: { total, page: 1, per_page: 200 } });

// The managers' count beside Dispatch Desk (docs/28 D6): work waiting for them, seen from any screen.
describe('the sidebar count of what waits for a manager', () => {
  beforeEach(() => {
    apiClientList.mockReset();
    role = 'MANAGER';
    permissions = ['outbound.record', 'outbound.finalize', 'invoices.manage'];
  });

  it('a manager sees the waiting count beside Dispatch Desk', async () => {
    apiClientList.mockReturnValue(waiting(3));
    renderSidebar();
    const desk = screen.getByRole('link', { name: /Dispatch Desk/ });
    await waitFor(() => expect(desk).toHaveTextContent('3'));
    expect(apiClientList).toHaveBeenCalledWith('/v1/dispatch/waiting');
  });

  it('no count at zero', async () => {
    apiClientList.mockReturnValue(waiting(0));
    renderSidebar();
    await waitFor(() => expect(apiClientList).toHaveBeenCalled());
    expect(screen.getByRole('link', { name: /Dispatch Desk/ })).toHaveTextContent(/^Dispatch Desk$/);
  });

  it('a munshi sees no count and nothing is requested', async () => {
    role = 'OPERATOR';
    permissions = ['outbound.record'];
    apiClientList.mockReturnValue(waiting(3));
    renderSidebar();
    expect(screen.getByRole('link', { name: /Dispatch Desk/ })).toHaveTextContent(/^Dispatch Desk$/);
    expect(apiClientList).not.toHaveBeenCalled();
  });
});
