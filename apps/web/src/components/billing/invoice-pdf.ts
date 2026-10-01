const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

/**
 * Open an invoice's PDF in a new tab. The PDF route needs the auth headers, so it
 * is fetched and opened as a blob — the one copy the detail page and the list
 * row share (docs/25 R-36).
 */
export async function openInvoicePdf(invoiceId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const res = await fetch(`${API_URL}/v1/invoices/${invoiceId}/pdf`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
    },
  });
  if (!res.ok) throw new Error('Failed to load PDF');
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}
