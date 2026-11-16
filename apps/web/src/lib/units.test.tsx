import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import { Units } from './units';

function page(goods: unknown[], ui: React.ReactNode) {
  apiClient.mockResolvedValue(goods);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const POTATO = { id: 'p', name: 'POTATO', unit_label: 'Bags', unit_name: 'Bag', is_active: true };
const APPLE = { id: 'a', name: 'APPLE', unit_label: 'Crates', unit_name: 'Crate', is_active: true };

beforeEach(() => apiClient.mockReset());

describe('Units — the unit of the goods, never a fixed "bags" (docs/32 2.4)', () => {
  it('shows the unit of the goods named', async () => {
    page([POTATO, APPLE], <p>120 <Units of="APPLE" /></p>);
    expect(await screen.findByText(/120 crates/)).toBeInTheDocument();
  });

  it('finds goods by id, and gives one unit when asked', async () => {
    page([POTATO, APPLE], <p>per <Units of="a" one /></p>);
    expect(await screen.findByText(/per crate/)).toBeInTheDocument();
  });

  it('a total across goods says "units" when the goods differ', async () => {
    page([POTATO, APPLE], <p>Total <Units /></p>);
    expect(await screen.findByText(/Total units/)).toBeInTheDocument();
  });

  it('a total says the shared unit when every kind of goods uses it', async () => {
    page([APPLE, { ...APPLE, id: 'k', name: 'KINNOW' }], <p>Total <Units /></p>);
    expect(await screen.findByText(/Total crates/)).toBeInTheDocument();
  });

  it('goods no longer stored do not decide the shared word', async () => {
    page([POTATO, { ...APPLE, is_active: false }], <p>Total <Units /></p>);
    expect(await screen.findByText(/Total bags/)).toBeInTheDocument();
  });

  it('falls back to "bags" with nothing loaded and no query provider', () => {
    render(<p>5 <Units /></p>);
    expect(screen.getByText(/5 bags/)).toBeInTheDocument();
  });
});
