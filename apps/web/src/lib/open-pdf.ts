/**
 * The one way the web opens a PDF in a new tab (docs/28 D8). Every PDF route needs the sign-in
 * headers, so the PDF is fetched and shown as a blob; nothing else in apps/web calls `window.open(`
 * (scripts/check-pdf-tabs.mjs).
 *
 * The tab opens FIRST, on the click: Chrome lets a page open a tab only while the click that asked
 * for it still counts as the user's (about five seconds), and a PDF can take longer to render. The
 * empty tab is filled when the PDF arrives and closed again if it fails. A caller that must wait
 * for something else first (a checkout) opens the tab itself with `openPdfTab()` on the click and
 * hands it in.
 */

/** A blank tab, opened at once; null when the browser refused it. */
export function openPdfTab(): Window | null {
  return window.open('', '_blank');
}

/**
 * Fetch an authenticated PDF route and return a blob URL for it (the route needs the sign-in
 * headers, so a plain link cannot reach it). For a page that shows the PDF in place, such as the
 * transfer acknowledgment's iframe; everything that opens a tab uses `openPdf`.
 *
 * The base is read here with `??`, not `||`: a production build sets NEXT_PUBLIC_API_URL to "" (the
 * page and the API share one address behind Caddy), and `||` would turn that into localhost:3001.
 */
export async function fetchPdfBlobUrl(path: string, what: string): Promise<string> {
  const base = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const res = await fetch(`${base}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
    },
  });
  if (!res.ok) throw new Error(`Could not open the ${what} (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/**
 * Fetch an authenticated PDF route and show it in a tab. Throws (after closing the tab) when the PDF
 * cannot be had; callers show the message.
 */
export async function openPdf(path: string, what: string, tab: Window | null = openPdfTab()): Promise<void> {
  try {
    const url = await fetchPdfBlobUrl(path, what);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank'); // the early tab was refused: one more try
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}
