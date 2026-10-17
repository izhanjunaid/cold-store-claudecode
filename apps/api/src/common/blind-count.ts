/**
 * The gate guard counts the bags on a truck BLIND: the number they type is compared with
 * the dispatch, and a guard who can read the expected count could simply copy it. So for
 * the SECURITY role every response is stripped of stock quantities — the count fields below
 * become `null` (never deleted: web code reads `null` as "not shown", but `undefined` turns
 * into `NaN%` in the capacity bars).
 *
 * `declared_quantity` is deliberately NOT here: it is the guard's own count.
 *
 * A NEW field that carries a stock quantity (bags on a lot, a rack, a room, a withdrawal)
 * must be added to BLIND_KEYS, or the guard can read it. Stored weights and money can still
 * be turned into a rough bag count; this is a deterrent, not a vault (docs/07).
 */

export const BLIND_KEYS: ReadonlySet<string> = new Set([
  'quantity_bags',
  'current_balance_bags',
  'parent_current_balance_bags',
  'quantity_withdrawn_bags',
  'bags',
  'unplaced_bags',
  'current_occupancy_bags',
  'available_capacity_bags',
  'authorized_quantity',
]);

/** "Room A → R-1 ×20, R-2 ×30" → "Room A → R-1, R-2": the rack names stay, the counts go. */
const COUNT_IN_LOCATION = /\s*×\s*\d+/g;

export function isBlindRole(role: string | null | undefined): boolean {
  return role === 'SECURITY';
}

/** A copy of `value` with every stock quantity nulled. Dates, Decimals and Buffers pass through untouched. */
export function redactBagCounts<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value; // Date, Prisma.Decimal, Buffer, …
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (BLIND_KEYS.has(key)) out[key] = null;
    else if (key === 'related_location' && typeof v === 'string') out[key] = v.replace(COUNT_IN_LOCATION, '');
    else out[key] = walk(v);
  }
  return out;
}
