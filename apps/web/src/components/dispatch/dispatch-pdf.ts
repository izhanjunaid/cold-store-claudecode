const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

/**
 * Open a withdrawal's dispatch note in a new tab. The route needs the auth headers,
 * so it is fetched and opened as a blob — the same way the withdrawal page does it.
 */
export async function openDispatchNotePdf(outboundId: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const res = await fetch(`${API_URL}/v1/outbound-events/${outboundId}/dispatch-note`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
    },
  });
  if (!res.ok) throw new Error('Failed to load the dispatch note');
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}
