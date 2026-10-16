'use client';

import { useLotPlacements } from '@/components/lot-location';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** rack_id → the bags typed for it ('' = untouched). Empty means the server trims the fullest racks. */
export type RackPicksValue = Record<string, string>;

/** The `picked_from` array the API takes, from what was typed. */
export function toPickedFrom(picks: RackPicksValue) {
  return Object.entries(picks)
    .map(([rack_id, bags]) => ({ rack_id, bags: parseInt(bags) || 0 }))
    .filter((p) => p.bags > 0);
}

export function picksTotal(picks: RackPicksValue) {
  return toPickedFrom(picks).reduce((s, p) => s + p.bags, 0);
}

/**
 * Optional "which racks did the bags come off" at checkout. Renders nothing when the lot
 * has no rack placements (the server then takes from unplaced stock). The caller blocks
 * dispatch while `picksTotal(value) > withdrawnBags`.
 */
export function RackPicks({
  lotId,
  withdrawnBags,
  value,
  onChange,
}: {
  lotId: string;
  withdrawnBags: number;
  value: RackPicksValue;
  onChange: (next: RackPicksValue) => void;
}) {
  const { data: location } = useLotPlacements(lotId);
  if (!location || location.placements.length === 0) return null;

  const total = picksTotal(value);
  return (
    <div className="space-y-1.5">
      <Label>Picked from {location.chamber_name ?? 'room'}</Label>
      <p className="text-xs text-muted-foreground">
        Optional. Left blank, the fullest racks are reduced automatically.
      </p>
      <div className="space-y-1.5">
        {location.placements.map((p) => (
          <div key={p.rack_id} className="flex items-center gap-3 text-sm">
            <span className="w-24 font-medium">{p.rack_name}</span>
            <span className="w-28 tabular-nums text-muted-foreground">{p.bags.toLocaleString()} bags here</span>
            <Input
              type="number"
              min={0}
              max={p.bags}
              aria-label={`Bags picked from ${p.rack_name}`}
              placeholder="Picked"
              value={value[p.rack_id] ?? ''}
              onChange={(e) => onChange({ ...value, [p.rack_id]: e.target.value })}
              className="h-8 w-28 tabular-nums"
            />
          </div>
        ))}
      </div>
      {total > withdrawnBags && (
        <p role="alert" className="text-xs font-medium text-destructive">
          Picked bags ({total}) exceed the withdrawn quantity ({withdrawnBags})
        </p>
      )}
    </div>
  );
}
