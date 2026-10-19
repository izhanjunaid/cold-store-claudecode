import { cn } from '@/lib/utils';

/**
 * Fill percentage of a room or rack, or `null` when the occupancy is not known to this user:
 * the gate guard counts bags blind, so the API sends them `null`, and that is "unknown", never 0%.
 */
export function capacityPct(occupied: number | null | undefined, capacity: number): number | null {
  if (occupied == null) return null;
  return capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
}

/** "42%", or a dash when the percentage is unknown. */
export function formatCapacityPct(pct: number | null): string {
  return pct == null ? '—' : `${pct}%`;
}

/** Fill-tier color used across room/rack capacity visuals. */
export function capacityBarColor(pct: number): string {
  if (pct > 90) return 'bg-destructive';
  if (pct > 75) return 'bg-warning';
  return 'bg-primary';
}

interface CapacityBarProps {
  occupied: number | null | undefined;
  capacity: number;
  /** Tailwind height class for the bar, e.g. "h-2" (default) or "h-3". */
  heightClass?: string;
  className?: string;
}

/** The standard occupancy fill bar (primary <75%, warning >75%, destructive >90%); empty track when unknown. */
export function CapacityBar({ occupied, capacity, heightClass = 'h-2', className }: CapacityBarProps) {
  const pct = capacityPct(occupied, capacity);
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-secondary', heightClass, className)}>
      {pct != null && (
        <div
          className={cn('rounded-full', heightClass, capacityBarColor(pct))}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      )}
    </div>
  );
}
