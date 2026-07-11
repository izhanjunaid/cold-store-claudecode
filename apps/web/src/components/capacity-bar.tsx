import { cn } from '@/lib/utils';

export function capacityPct(occupied: number, capacity: number): number {
  return capacity > 0 ? Math.round((occupied / capacity) * 100) : 0;
}

/** Fill-tier color used across room/rack capacity visuals. */
export function capacityBarColor(pct: number): string {
  if (pct > 90) return 'bg-destructive';
  if (pct > 75) return 'bg-warning';
  return 'bg-primary';
}

interface CapacityBarProps {
  occupied: number;
  capacity: number;
  /** Tailwind height class for the bar, e.g. "h-2" (default) or "h-3". */
  heightClass?: string;
  className?: string;
}

/** The standard occupancy fill bar (primary <75%, warning >75%, destructive >90%). */
export function CapacityBar({ occupied, capacity, heightClass = 'h-2', className }: CapacityBarProps) {
  const pct = capacityPct(occupied, capacity);
  return (
    <div className={cn('w-full overflow-hidden rounded-full bg-secondary', heightClass, className)}>
      <div
        className={cn('rounded-full', heightClass, capacityBarColor(pct))}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}
