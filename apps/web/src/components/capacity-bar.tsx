import { cn } from '@/lib/utils';

export function capacityPct(occupied: number, capacity: number): number {
  return capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
}

/** Facility default for `chamber_capacity_warning_pct` when settings haven't loaded yet. */
export const DEFAULT_CAPACITY_WARN_PCT = 90;

export type CapacityTier = 'ok' | 'warn' | 'critical';

/**
 * Single source of truth for the fill-tier breakpoints used by every room/rack capacity visual
 * (list card, map tile, room detail). `warnPct` is the owner-configurable
 * `chamber_capacity_warning_pct` facility setting — the same number the API and the daily digest
 * alert on (lot.service.ts, digest.service.ts) — so pass it from `useFacility()` and a changed
 * setting moves every capacity visual at once. `critical` fires exactly at that line (it IS the
 * alert threshold); `warn` is an earlier heads-up at 80% of the way there.
 */
export function capacityTier(pct: number, warnPct: number = DEFAULT_CAPACITY_WARN_PCT): CapacityTier {
  if (pct > warnPct) return 'critical';
  if (pct > warnPct * 0.8) return 'warn';
  return 'ok';
}

/** Fill-tier color for the thin progress bar (CapacityBar) — see capacityTier. */
export function capacityBarColor(pct: number, warnPct: number = DEFAULT_CAPACITY_WARN_PCT): string {
  const tier = capacityTier(pct, warnPct);
  return tier === 'critical' ? 'bg-destructive' : tier === 'warn' ? 'bg-warning' : 'bg-primary';
}

interface CapacityBarProps {
  occupied: number;
  capacity: number;
  /** Tailwind height class for the bar, e.g. "h-2" (default) or "h-3". */
  heightClass?: string;
  className?: string;
  /** Owner-configured `chamber_capacity_warning_pct` — see capacityBarColor. */
  warnPct?: number;
}

/** The standard occupancy fill bar — color driven by the facility's capacity warning threshold. */
export function CapacityBar({ occupied, capacity, heightClass = 'h-2', className, warnPct }: CapacityBarProps) {
  const pct = capacityPct(occupied, capacity);
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-secondary', heightClass, className)}>
      <div
        className={cn('rounded-full', heightClass, capacityBarColor(pct, warnPct))}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}
