import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPdfBlobUrl, openPdf, openPdfTab } from './open-pdf';

// Chrome lets a page open a tab only while the click that asked for it still counts as the user's
// (about 5 s), and a PDF can take longer to render: the tab must open first and be filled later.
describe('opening a PDF in a new tab', () => {
  const tab = { location: { href: '' }, close: vi.fn() };

  beforeEach(() => {
    tab.location.href = '';
    tab.close.mockReset();
    localStorage.setItem('access_token', 'token');
    localStorage.setItem('facility_id', 'facility');
    URL.createObjectURL = vi.fn(() => 'blob:paper');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('opens the tab while the click still counts, and fills it when the PDF arrives', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    let arrive!: (r: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise<Response>((r) => (arrive = r)));

    const done = openPdf('/v1/x/pdf', 'paper');
    expect(open).toHaveBeenCalledTimes(1); // before the PDF is back
    arrive({ ok: true, blob: async () => new Blob(['%PDF-1.4']) } as Response);
    await done;

    expect(tab.location.href).toBe('blob:paper');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('closes the waiting tab again when the PDF fails, and says which paper and why', async () => {
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(openPdf('/v1/x/pdf', 'paper')).rejects.toThrow('Could not open the paper (500)');
    expect(tab.close).toHaveBeenCalled();
  });

  it('closes the waiting tab when the network fails', async () => {
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

    await expect(openPdf('/v1/x/pdf', 'paper')).rejects.toThrow('offline');
    expect(tab.close).toHaveBeenCalled();
  });

  it('uses a tab it is handed, and opens no other', async () => {
    const open = vi.spyOn(window, 'open');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);

    await openPdf('/v1/x/pdf', 'paper', tab as unknown as Window);

    expect(open).not.toHaveBeenCalled();
    expect(tab.location.href).toBe('blob:paper');
  });

  it('a blocked pop-up (no tab) still opens the PDF once it arrives', async () => {
    // The early tab was refused; the one more try (after the wait) is allowed.
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(null).mockReturnValueOnce(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);

    await openPdf('/v1/x/pdf', 'paper');

    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith('blob:paper', '_blank');
  });

  it('openPdfTab is a blank tab, opened at once', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    expect(openPdfTab()).toBe(tab);
    expect(open).toHaveBeenCalledWith('', '_blank');
  });

  it('sends the sign-in and the facility with the request', async () => {
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);

    await openPdf('/v1/x/pdf', 'paper');

    expect(fetchSpy.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer token', 'X-Facility-ID': 'facility' } });
  });

  // A production build has NEXT_PUBLIC_API_URL="" (same address, Caddy proxies /v1). An `||` fallback
  // would turn that into localhost:3001, which nothing serves on a client box.
  it('with NEXT_PUBLIC_API_URL empty (a production build) it fetches /v1/… on the page’s own address', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);

    await openPdf('/v1/invoices/inv-1/pdf', 'invoice');

    expect(fetchSpy.mock.calls[0]![0]).toBe('/v1/invoices/inv-1/pdf');
  });

  it('with an API address set it is used as the base', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test');
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);

    await openPdf('/v1/invoices/inv-1/pdf', 'invoice');

    expect(fetchSpy.mock.calls[0]![0]).toBe('http://api.test/v1/invoices/inv-1/pdf');
  });
});

describe('a PDF shown in place (fetchPdfBlobUrl)', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'token');
    URL.createObjectURL = vi.fn(() => 'blob:ack');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns a blob URL, from the page’s own address in a production build', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);
    expect(await fetchPdfBlobUrl('/v1/lots/l1/transfer/t1/acknowledgment', 'transfer acknowledgment')).toBe('blob:ack');
    expect(fetchSpy.mock.calls[0]![0]).toBe('/v1/lots/l1/transfer/t1/acknowledgment');
  });

  it('says which paper and why when it fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(fetchPdfBlobUrl('/v1/x', 'transfer acknowledgment')).rejects.toThrow('Could not open the transfer acknowledgment (404)');
  });
});

describe('the tab while the PDF renders, and when it cannot be shown', () => {
  beforeEach(() => {
    localStorage.setItem('access_token', 'token');
    URL.createObjectURL = vi.fn(() => 'blob:paper');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('says in the blank tab that the paper is being prepared', () => {
    const doc = { title: '', body: { textContent: '' } };
    const waiting = { document: doc, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(waiting as unknown as Window);
    openPdfTab();
    expect(doc.title).toMatch(/preparing/i);
    expect(doc.body.textContent).toMatch(/preparing/i);
  });

  it('does not fill a tab the person closed, and does not open another', async () => {
    const closed = { location: { href: '' }, close: vi.fn(), closed: true };
    const open = vi.spyOn(window, 'open').mockReturnValue(closed as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);
    await openPdf('/v1/x/pdf', 'paper');
    expect(closed.location.href).toBe('');
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('says so when the browser blocks the tab and the fallback as well', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['%PDF']) } as Response);
    await expect(openPdf('/v1/x/pdf', 'paper')).rejects.toThrow(/allow pop-ups/i);
  });
});
