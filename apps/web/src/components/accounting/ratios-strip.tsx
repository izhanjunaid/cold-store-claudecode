'use client';

export interface RatioItem {
  label: string;
  value: string;
  hint?: string;
}

/** Compact KPI strip beneath a statement (margins, liquidity, leverage). */
export function RatiosStrip({ items }: { items: RatioItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg border bg-card px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{i.label}</div>
          <div className="text-base font-semibold tabular-nums">{i.value}</div>
          {i.hint && <div className="text-[11px] text-muted-foreground">{i.hint}</div>}
        </div>
      ))}
    </div>
  );
}
