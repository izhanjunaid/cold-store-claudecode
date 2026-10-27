'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCount, formatDateTime } from '@/lib/format';

export interface TruckLine {
  outbound_id: string;
  dispatch_note_number: string | null;
  status: string;
  stage: string;
  lot_number: string;
  marka: string | null;
  billing_party: { id: string; name: string };
  quantity_withdrawn_bags: number | null;
}

export interface TruckInside {
  gate_pass_id: string;
  pass_number: string;
  vehicle_number: string;
  driver_name: string | null;
  arrived_at: string;
  /** Something weighed and nothing still to weigh: the whole truck can be checked out. */
  ready: boolean;
  lines: TruckLine[];
}

const STAGE_TEXT: Record<string, string> = {
  BOOKED: 'to weigh',
  WEIGHED: 'weighed',
  DISPATCHED: 'dispatched',
  PAID: 'paid',
};

/** Lines a truck checkout would still dispatch: everything on it not already checked out. */
export const linesToCheckOut = (t: TruckInside) => t.lines.filter((l) => l.status !== 'DISPATCHED');

/**
 * The trucks inside the gate, each with the lots booked onto it. A truck carrying several lots
 * is checked out here in one go; a truck with one lot keeps its row's own button in the queue.
 */
export function TrucksPanel({
  trucks,
  canDispatch,
  onAddLot,
  onCheckout,
  onSlip,
}: {
  trucks: TruckInside[];
  canDispatch: boolean;
  onAddLot: (plate: string) => void;
  onCheckout: (passId: string) => void;
  onSlip: (passId: string) => void;
}) {
  if (trucks.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trucks inside</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {trucks.map((t) => {
          const several = linesToCheckOut(t).length >= 2;
          return (
            <div key={t.gate_pass_id} data-truck className="space-y-2 rounded-md border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono font-semibold" data-truck-plate>
                  {t.vehicle_number}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.pass_number} · in since {formatDateTime(t.arrived_at)}
                </span>
              </div>
              {t.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing booked on this truck yet.</p>
              ) : (
                <ul className="divide-y rounded border text-sm">
                  {t.lines.map((l) => (
                    <li key={l.outbound_id} className="flex items-center gap-2 px-2 py-1">
                      <span className="font-mono text-xs">{l.dispatch_note_number ?? '—'}</span>
                      <span className="font-mono">{l.lot_number}</span>
                      {l.marka && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">{l.marka}</span>}
                      <span className="truncate text-muted-foreground">{l.billing_party.name}</span>
                      <span className="ml-auto shrink-0 tabular-nums">{formatCount(l.quantity_withdrawn_bags)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{STAGE_TEXT[l.stage] ?? l.stage.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex justify-end gap-1.5">
                {t.lines.some((l) => l.status === 'DISPATCHED') && (
                  <Button size="sm" variant="ghost" onClick={() => onSlip(t.gate_pass_id)}>
                    Load slip
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => onAddLot(t.vehicle_number)}>
                  Add a lot
                </Button>
                {several && canDispatch && (
                  <Button size="sm" disabled={!t.ready} onClick={() => onCheckout(t.gate_pass_id)}>
                    Check out truck
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
