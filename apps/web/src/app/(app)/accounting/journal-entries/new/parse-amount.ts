/**
 * Parse an amount cell. Returns `null` for a non-empty value that is not a
 * valid amount, so the caller can refuse rather than post a wrong number.
 *
 * Group separators are stripped first: a facility set to lakh/crore reads and
 * types "40,00,000", and `parseFloat` would silently return **40** for that —
 * a wrong figure, not an obvious one. Empty stays 0, which is how a blank
 * debit-or-credit cell is meant to read.
 *
 * Lives in its own module rather than in `page.tsx` because the App Router
 * permits a page to export only `default` and its known metadata members; any
 * other named export fails `next build` with an opaque `OmitWithTag` type error
 * — which is what kept CI red from phase/22 onward.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[,\s ]/g, '');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
