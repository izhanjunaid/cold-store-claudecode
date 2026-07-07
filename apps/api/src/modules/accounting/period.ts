/**
 * Derive the accounting period from an entry date in UTC. entry_date is
 * stored as @db.Date (truncated in UTC), so deriving the period with
 * local-time getters could disagree with the stored date around month
 * boundaries on servers not running in UTC.
 */
export function derivePeriod(entryDate: Date): { month: number; year: number } {
  return { month: entryDate.getUTCMonth() + 1, year: entryDate.getUTCFullYear() };
}
