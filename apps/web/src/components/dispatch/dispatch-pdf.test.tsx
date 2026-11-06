import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDispatchNotePdf, openLoadSlipPdf } from './dispatch-pdf';
import { openInvoicePdf } from '../billing/invoice-pdf';

// The tab-first behaviour itself is tested in lib/open-pdf.test.ts; these pin each paper's route and
// that a tab opened earlier (the checkout's click) is the one that gets filled.
describe('the dispatch and invoice papers', () => {
  const tab = { location: { href: '' }, close: vi.fn() };
  const ok = { ok: true, blob: async () => new Blob(['%PDF-1.4']) } as Response;

  beforeEach(() => {
    tab.location.href = '';
    tab.close.mockReset();
    URL.createObjectURL = vi.fn(() => 'blob:paper');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('a load slip is fetched from the truck, in the tab it is handed', async () => {
    const open = vi.spyOn(window, 'open');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
    await openLoadSlipPdf('pass-1', tab as unknown as Window);
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/\/v1\/dispatch\/trucks\/pass-1\/load-slip$/);
    expect(open).not.toHaveBeenCalled();
    expect(tab.location.href).toBe('blob:paper');
  });

  it('a dispatch note is fetched from the withdrawal', async () => {
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok);
    await openDispatchNotePdf('ob-1');
    expect(String(fetchSpy.mock.calls[0]![0])).toMatch(/\/v1\/outbound-events\/ob-1\/dispatch-note$/);
  });

  it('an invoice opens its tab first too, and closes it when the PDF fails', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
    const pending = openInvoicePdf('inv-1');
    expect(open).toHaveBeenCalledTimes(1); // before the answer
    await expect(pending).rejects.toThrow(/invoice \(404\)/);
    expect(tab.close).toHaveBeenCalled();
  });
});
