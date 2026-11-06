import { openPdf } from '@/lib/open-pdf';

/**
 * Open an invoice's PDF in a new tab: the one copy the detail page, the list row and the desk
 * share (docs/25 R-36). The tab opens on the click, before the PDF is rendered (docs/28 D8).
 */
export const openInvoicePdf = (invoiceId: string, tab?: Window | null) =>
  openPdf(`/v1/invoices/${invoiceId}/pdf`, 'invoice', tab);
