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
let collapsed = false;
vi.mock('@/stores/ui.store', () => ({ useUiStore: () => ({ sidebarCollapsed: collapsed, toggleSidebar: vi.fn() }) }));

import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from './sidebar';

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Sidebar />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const waiting = (total: number) => Promise.resolve({ data: [], meta: { total, page: 1, per_page: 200 } });

// The managers' count beside Dispatch Desk (docs/28 D6): work waiting for them, seen from any screen.
describe('the sidebar count of what waits for a manager', () => {
  beforeEach(() => {
    apiClientList.mockReset();
    collapsed = false;
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

  // Visually hidden text, not an aria-label on a role-less span: that is not reliably read by assistive tech.
  it('the count says in words what it counts, in text a screen reader reads', async () => {
    apiClientList.mockReturnValue(waiting(3));
    renderSidebar();
    const desk = screen.getByRole('link', { name: /Dispatch Desk/ });
    await waitFor(() => expect(desk).toHaveTextContent('3 waiting for a manager'));
  });

  it('collapsed, the dot is silent to the eye and still says what waits, with the link named', async () => {
    collapsed = true;
    apiClientList.mockReturnValue(waiting(3));
    renderSidebar();
    const desk = await screen.findByRole('link', { name: /Dispatch Desk.*3 waiting for a manager/ });
    expect(desk).toBeInTheDocument();
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
