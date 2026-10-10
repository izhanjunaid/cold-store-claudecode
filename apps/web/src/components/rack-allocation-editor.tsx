'use client';

import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditableRows, type EditableRowColumn } from '@/components/form';
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
 * Row-based rack allocation: each row picks a rack and a bag count, with a live remaining
 * counter and a one-tap fill of everything onto one rack. Built on the shared EditableRows
 * primitive (docs/24_ui_density_spec.md §7) — the prior art it was generalized from.
 */
export function RackAllocationEditor({ racks, rows, onChange, totalBags, disabled }: RackAllocationEditorProps) {
  if (racks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This room has no racks yet — the bags will be stored unplaced.
      </p>
    );
  }

  const placed = allocationTotal(rows);
  const remaining = totalBags - placed;
  const usedRackIds = new Set(rows.map((r) => r.rack_id).filter(Boolean));

  const rackOccupancyHint = (rack: RackRef) =>
    `${rack.name} — ${(rack.max_capacity_bags - rack.current_occupancy_bags).toLocaleString()} free of ${rack.max_capacity_bags.toLocaleString()}`;

  const overCapacityFor = (row: AllocationRow) => {
    const rack = racks.find((r) => r.id === row.rack_id);
    const bags = parseInt(row.bags) || 0;
    return rack != null && bags > 0 && rack.current_occupancy_bags + bags > rack.max_capacity_bags;
  };

  const columns: EditableRowColumn<AllocationRow>[] = [
    {
      key: 'rack',
      header: 'Rack',
      width: '1fr',
      render: (row, update) => (
        <select
          className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={row.rack_id}
          disabled={disabled}
          onChange={(e) => update({ rack_id: e.target.value })}
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
      ),
    },
    {
      key: 'bags',
      header: 'Bags',
      width: '140px',
      align: 'right',
      render: (row, update) => (
        <Input
          type="number"
          min={1}
          placeholder="Bags"
          value={row.bags}
          disabled={disabled}
          onChange={(e) => update({ bags: e.target.value })}
          className={cn('h-8 text-right tabular-nums', overCapacityFor(row) && 'border-warning')}
        />
      ),
    },
  ];

  return (
    <div className="space-y-2">
      <EditableRows
        rows={rows}
        onChange={onChange}
        columns={columns}
        newRow={() => ({ rack_id: '', bags: '' })}
        addLabel="Add rack"
        maxRows={racks.length}
        disabled={disabled}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {totalBags > 0 && rows.length === 0 && (
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
                'text-xs tabular-nums',
                remaining < 0 ? 'font-medium text-destructive' : 'text-muted-foreground',
              )}
            >
              {remaining < 0
                ? `${Math.abs(remaining).toLocaleString()} bags over the lot balance`
                : `${remaining.toLocaleString()} of ${totalBags.toLocaleString()} bags unplaced`}
            </span>
          </div>
        }
      />

      {rows.some(overCapacityFor) && (
        <p className="text-xs text-amber-700">
          A rack will exceed its capacity — allowed, but consider spreading the bags.
        </p>
      )}
    </div>
  );
}
