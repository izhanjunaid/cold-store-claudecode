const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

/** Fetch an authenticated PDF route and open it in a new tab (the route needs the auth headers). */
async function openPdf(path: string, what: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
    },
  });
  if (!res.ok) throw new Error(`Failed to load the ${what}`);
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

/** A withdrawal's dispatch note. */
export const openDispatchNotePdf = (outboundId: string) =>
  openPdf(`/v1/outbound-events/${outboundId}/dispatch-note`, 'dispatch note');

/** A truck's load slip: every lot on it, the bills, the receipts and any credit. */
export const openLoadSlipPdf = (passId: string) => openPdf(`/v1/dispatch/trucks/${passId}/load-slip`, 'load slip');
