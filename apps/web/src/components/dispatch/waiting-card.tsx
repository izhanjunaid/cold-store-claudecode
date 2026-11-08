'use client';

import { localIsoDate, MANAGER_ASK_TEXT, MANAGER_REASON_TEXT, normalizePlate } from '@coldchain/shared';
import { formatCount, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { calledAt } from '@/components/dispatch/call-manager';
import { checkedOutWhole, type TruckInside } from '@/components/dispatch/trucks-panel';
import type { WaitingRow } from '@/hooks/use-waiting-for-manager';

/** Why it waits: what the munshi called for, else the solo rule it fails. */
function why(r: WaitingRow) {
  if (r.ask_code) return `Called ${r.asked_at ? calledAt(r.asked_at) : ''} — ${MANAGER_ASK_TEXT[r.ask_code]}`;
  return r.reason_code ? MANAGER_REASON_TEXT[r.reason_code] : '';
}

/**
 * The managers' waiting list on the desk (docs/28 D6, O7): every withdrawal a manager must finish, with
 * its reason, called ones first. A line on a truck carrying several lots is checked out with its truck.
 * Bookings dated before today that nobody called about sit apart, with Cancel: a forgotten one holds
 * its truck at the gate (D3).
 */
export function WaitingCard({
  rows,
  total,
  trucks,
  onCheckout,
  onTruckCheckout,
  onCancel,
}: {
  rows: WaitingRow[];
  total: number;
  trucks: TruckInside[];
  onCheckout: (row: WaitingRow) => void;
  onTruckCheckout: (passId: string) => void;
  onCancel: (id: string) => void;
}) {
  if (total === 0) return null;
  const today = localIsoDate();
  const before = (r: WaitingRow) => r.outbound_date < today;
  // A called row keeps its place at the top; only an uncalled one goes to the "Booked before today" group.
  const isOld = (r: WaitingRow) => !r.asked_at && before(r);
  const truckOf = (r: WaitingRow) =>
    r.vehicle_number
      ? trucks.find((t) => checkedOutWhole(t) && normalizePlate(t.vehicle_number) === normalizePlate(r.vehicle_number!))
      : undefined;

  const item = (r: WaitingRow) => {
    const truck = truckOf(r);
    const past = before(r);
    return (
      <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
        <span className="font-mono text-xs">{r.dispatch_note_number ?? '—'}</span>
        <span className="font-mono">{r.lot_number}</span>
        <span className="text-muted-foreground">{r.owner_party_name ?? '—'}</span>
        {r.marka && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">{r.marka}</span>}
        <span className="font-mono">{r.vehicle_number ?? '—'}</span>
        <span className="tabular-nums">{formatCount(r.quantity_withdrawn_bags)} bags</span>
        {past && <span className="text-xs text-muted-foreground">booked for {formatDate(r.outbound_date)}</span>}
        <span className="text-xs text-amber-800">{why(r)}</span>
        <span className="ml-auto flex items-center gap-1">
          {truck ? (
            <Button size="sm" onClick={() => onTruckCheckout(truck.gate_pass_id)}>
              Check out truck
            </Button>
          ) : (
            <Button size="sm" onClick={() => onCheckout(r)}>
              Dispatch &amp; Collect
            </Button>
          )}
          {past && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onCancel(r.id)}>
              Cancel
            </Button>
          )}
        </span>
      </li>
    );
  };

  const current = rows.filter((r) => !isOld(r));
  const old = rows.filter(isOld);
  return (
    <section aria-label="Waiting for a manager">
      <Card className="border-amber-300">
        <CardHeader>
          <CardTitle className="text-base">Waiting for a manager ({total})</CardTitle>
        </CardHeader>
        <CardContent>
          {current.length > 0 && <ul className="divide-y">{current.map(item)}</ul>}
          {old.length > 0 && (
            <div role="group" aria-label="Booked before today" className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booked before today</p>
              <ul className="divide-y">{old.map(item)}</ul>
            </div>
          )}
          {total > rows.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {rows.length} of {total}.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
