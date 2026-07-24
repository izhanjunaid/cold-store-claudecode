/**
 * Fiscal-year arithmetic for the balance-sheet virtual closing.
 *
 * UTC throughout so it agrees with period.ts (entry-date → period derivation).
 * The web has its own `fyBounds` in fiscal-period.ts which uses local-time
 * getters — correct for a browser rendering local dates, wrong on the server —
 * so this is a deliberate re-implementation, not a shared import.
 */

/** First calendar day of the fiscal year containing `asOf` (UTC midnight). */
export function fiscalYearStart(asOf: Date, fyStartMonth: number): Date {
  const month = asOf.getUTCMonth() + 1; // 1–12
  const year = month >= fyStartMonth ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, fyStartMonth - 1, 1));
}
