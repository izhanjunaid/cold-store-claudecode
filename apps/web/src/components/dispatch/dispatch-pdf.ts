const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

/**
 * Fetch an authenticated PDF route and show it in a new tab (the route needs the auth headers).
 * The tab opens first: Chrome lets a page open one only while the click that asked for it still
 * counts as the user's — about five seconds — and rendering a slip can take longer. It is filled when
 * the PDF arrives, and closed again if the PDF fails.
 */
async function openPdf(path: string, what: string): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const token = localStorage.getItem('access_token');
    const facilityId = localStorage.getItem('facility_id');
    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
      },
    });
    if (!res.ok) throw new Error(`Failed to load the ${what}`);
    const url = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = url;
    else window.open(url, '_blank'); // the early tab was refused: one more try
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** A withdrawal's dispatch note. */
export const openDispatchNotePdf = (outboundId: string) =>
  openPdf(`/v1/outbound-events/${outboundId}/dispatch-note`, 'dispatch note');

/** A truck's load slip: every lot on it, the bills, the receipts and any credit. */
export const openLoadSlipPdf = (passId: string) => openPdf(`/v1/dispatch/trucks/${passId}/load-slip`, 'load slip');
