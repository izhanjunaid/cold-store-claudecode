import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { PartyPicker } from './party-picker';

const FIRST = { id: 'p1', name: 'Ali Traders', party_type: 'TRADER', phone_primary: '03001234567' };
const SECOND = { id: 'p2', name: 'Bashir Farms', party_type: 'FARMER', phone_primary: null };
// Party 150 of a long list: never in the first page of results.
const FAR = { id: 'p150', name: 'Zafar Arhti', party_type: 'ARHTI', phone_primary: null };

function renderPicker(props: Partial<React.ComponentProps<typeof PartyPicker>> = {}) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PartyPicker value="" onChange={onChange} testId="picker" {...props} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('PartyPicker', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockImplementation((path: string) => {
      if (path === `/v1/parties/${FAR.id}`) return Promise.resolve(FAR);
      if (path.includes('search=zafar')) return Promise.resolve([FAR]);
      return Promise.resolve([FIRST, SECOND]);
    });
  });

  it('searches the server with the typed text and the kind, and picks what it returns', async () => {
    const onChange = renderPicker({ kind: 'customer' });
    fireEvent.click(screen.getByTestId('picker'));
    fireEvent.change(await screen.findByPlaceholderText(/search name or phone/i), { target: { value: 'zafar' } });

    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/v1/parties?is_active=true&per_page=20&search=zafar&kind=customer'),
    );
    fireEvent.click(await screen.findByText(FAR.name));
    expect(onChange).toHaveBeenCalledWith(FAR.id, FAR);
  });

  it('names a chosen party that is not among the results', async () => {
    renderPicker({ value: FAR.id });
    await waitFor(() => expect(screen.getByTestId('picker')).toHaveTextContent(FAR.name));
  });

  it('leaves out excluded parties, and a filter can be cleared', async () => {
    const onChange = renderPicker({ value: FIRST.id, exclude: [SECOND.id], clearable: true, placeholder: 'All parties' });
    fireEvent.click(screen.getByTestId('picker'));
    expect(await screen.findAllByText(FIRST.name)).not.toHaveLength(0);
    expect(screen.queryByText(SECOND.name)).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: /all parties/i }));
    expect(onChange).toHaveBeenCalledWith('', undefined);
  });
});
