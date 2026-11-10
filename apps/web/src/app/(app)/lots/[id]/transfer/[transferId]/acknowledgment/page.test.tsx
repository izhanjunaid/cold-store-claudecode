import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'lot-1', transferId: 'transfer-12345678' }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/lots/lot-1/transfer/transfer-12345678/acknowledgment',
}));
const fetchPdfBlobUrl = vi.fn();
vi.mock('@/lib/open-pdf', () => ({ fetchPdfBlobUrl: (...a: unknown[]) => fetchPdfBlobUrl(...a) }));

import AcknowledgmentPage from './page';

describe('the transfer acknowledgment page', () => {
  beforeEach(() => {
    fetchPdfBlobUrl.mockReset();
    URL.revokeObjectURL = vi.fn();
  });

  it('says why the paper could not be had once, without a prefix of its own', async () => {
    fetchPdfBlobUrl.mockRejectedValue(new Error('Could not open the transfer acknowledgment (404)'));
    render(<AcknowledgmentPage />);

    expect(await screen.findByText('Could not open the transfer acknowledgment (404)')).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load acknowledgment/)).not.toBeInTheDocument();
  });

  it('frees the paper it loaded when the page is left', async () => {
    fetchPdfBlobUrl.mockResolvedValue('blob:ack');
    const { unmount } = render(<AcknowledgmentPage />);
    await waitFor(() => expect(screen.getByTitle('Transfer Acknowledgment PDF')).toBeInTheDocument());

    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:ack');
  });
});
