/**
 * What each asset category is, in words. Which accounts it posts to is the
 * registry's business (ASSET_CATEGORY_ACCOUNTS) — labels used to quote codes that
 * were wrong for two of the five categories (docs/25 C-34, C-38).
 */
export const CATEGORY_LABELS: Record<string, string> = {
  COLD_PLANT: 'Cold plant & refrigeration (direct cost)',
  BUILDING: 'Building',
  VEHICLE: 'Vehicle',
  COMPUTER: 'Computer hardware',
  OTHER: 'Furniture, fixtures & other equipment',
};
