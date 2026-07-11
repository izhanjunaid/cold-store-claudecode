'use client';

import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { RackRef } from '@/hooks/use-reference-data';

export interface AllocationRow {
  rack_id: string;
  bags: string; // kept as string for controlled inputs; parse on submit
}

export function allocationTotal(rows: AllocationRow[]): number {
  return rows.reduce((sum, r) => sum + (parseInt(r.bags) || 0), 0);
}

export function toPlacementsPayload(rows: AllocationRow[]): { rack_id: string; bags: number }[] {
  return rows
    .filter((r) => r.rack_id && (parseInt(r.bags) || 0) > 0)
    .map((r) => ({ rack_id: r.rack_id, bags: parseInt(r.bags) }));
}

interface RackAllocationEditorProps {
  racks: RackRef[];
  rows: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
  /** Total bags that need placing — drives the remaining counter. */
  totalBags: number;
  disabled?: boolean;
}

/**
 * Row-based rack allocation: each row picks a rack and a bag count, with a
 * live remaining counter and a one-tap fill of everything onto one rack.
 */
export function RackAllocationEditor({ racks, rows, onChange, totalBags, disabled }: RackAllocationEditorProps) {
  const placed = allocationTotal(rows);
  const remaining = totalBags - placed;
  const usedRackIds = new Set(rows.map((r) => r.rack_id).filter(Boolean));

  const update = (idx: number, patch: Partial<AllocationRow>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const rackOccupancyHint = (rack: RackRef) =>
    `${rack.name} — ${(rack.max_capacity_bags - rack.current_occupancy_bags).toLocaleString()} free of ${rack.max_capacity_bags.toLocaleString()}`;

  return (
    <div className="space-y-2">
      {racks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          This room has no racks yet — the bags will be stored unplaced.
        </p>
      ) : (
        <>
          {rows.map((row, idx) => {
            const rack = racks.find((r) => r.id === row.rack_id);
            const bags = parseInt(row.bags) || 0;
            const overCapacity =
              rack != null && bags > 0 && rack.current_occupancy_bags + bags > rack.max_capacity_bags;
            return (
              <div key={idx} className="flex items-center gap-2">
                <select
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                  value={row.rack_id}
                  disabled={disabled}
                  onChange={(e) => update(idx, { rack_id: e.target.value })}
                >
                  <option value="">Select rack…</option>
                  {racks
                    .filter((r) => r.id === row.rack_id || !usedRackIds.has(r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {rackOccupancyHint(r)}
                      </option>
                    ))}
                </select>
                <Input
                  type="number"
                  min={1}
                  placeholder="Bags"
                  value={row.bags}
                  disabled={disabled}
                  onChange={(e) => update(idx, { bags: e.target.value })}
                  className={cn('h-9 w-28 tabular-nums', overCapacity && 'border-warning')}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={disabled}
                  onClick={() => onChange(rows.filter((_, i) => i !== idx))}
                  aria-label="Remove row"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            );
          })}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || rows.length >= racks.length}
              onClick={() => onChange([...rows, { rack_id: '', bags: '' }])}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add rack
            </Button>
            {totalBags > 0 && rows.length === 0 && racks.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  // One tap: everything on the emptiest rack.
                  const emptiest = [...racks].sort(
                    (a, b) =>
                      (b.max_capacity_bags - b.current_occupancy_bags) -
                      (a.max_capacity_bags - a.current_occupancy_bags),
                  )[0];
                  if (emptiest) onChange([{ rack_id: emptiest.id, bags: String(totalBags) }]);
                }}
              >
                <Wand2 className="h-3.5 w-3.5" aria-hidden />
                All on one rack
              </Button>
            )}
            <span
              className={cn(
                'ml-auto text-xs tabular-nums',
                remaining < 0 ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {remaining < 0
                ? `${Math.abs(remaining).toLocaleString()} bags over the lot balance`
                : `${remaining.toLocaleString()} of ${totalBags.toLocaleString()} bags unplaced`}
            </span>
          </div>

          {rows.some((row) => {
            const rack = racks.find((r) => r.id === row.rack_id);
            const bags = parseInt(row.bags) || 0;
            return rack != null && bags > 0 && rack.current_occupancy_bags + bags > rack.max_capacity_bags;
          }) && (
            <p className="text-xs text-amber-700">
              A rack will exceed its capacity — allowed, but consider spreading the bags.
            </p>
          )}
        </>
      )}
    </div>
  );
}
