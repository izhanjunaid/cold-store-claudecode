import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openLoadSlipPdf } from './dispatch-pdf';

// Chrome lets a page open a tab only while the click that asked for it still counts as the user's
// (about 5 s), and a slip can take longer to render: the tab must open first and be filled later.
describe('opening a slip or note in a new tab', () => {
  const tab = { location: { href: '' }, close: vi.fn() };

  beforeEach(() => {
    tab.location.href = '';
    tab.close.mockReset();
    localStorage.setItem('access_token', 'token');
    localStorage.setItem('facility_id', 'facility');
    URL.createObjectURL = vi.fn(() => 'blob:slip');
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the tab while the click still counts, and fills it when the PDF arrives', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    let arrive!: (r: unknown) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise((r) => (arrive = r)) as Promise<Response>);

    const done = openLoadSlipPdf('pass-1');
    expect(open).toHaveBeenCalledTimes(1); // before the PDF is back
    arrive({ ok: true, blob: async () => new Blob(['%PDF-1.4']) });
    await done;

    expect(tab.location.href).toBe('blob:slip');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('closes the waiting tab again when the PDF fails', async () => {
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(openLoadSlipPdf('pass-1')).rejects.toThrow(/load slip/);
    expect(tab.close).toHaveBeenCalled();
  });
});
