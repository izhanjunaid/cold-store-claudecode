import { openPdf } from '@/lib/open-pdf';

/**
 * A withdrawal's dispatch note. `tab` is a tab the caller opened earlier, on the click (a checkout
 * waits for its POST first); without one the tab opens now.
 */
export const openDispatchNotePdf = (outboundId: string, tab?: Window | null) =>
  openPdf(`/v1/outbound-events/${outboundId}/dispatch-note`, 'dispatch note', tab);

/** A truck's load slip: every lot on it, the bills, the receipts and any credit. */
export const openLoadSlipPdf = (passId: string, tab?: Window | null) =>
  openPdf(`/v1/dispatch/trucks/${passId}/load-slip`, 'load slip', tab);
