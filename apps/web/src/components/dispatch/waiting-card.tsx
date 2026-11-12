'use client';

import { useState } from 'react';
import {
  localIsoDate,
  MANAGER_ALLOW_TEXT,
  MANAGER_ASK_TEXT,
  MANAGER_REASON_TEXT,
  normalizePlate,
  type ManagerAllowCode,
} from '@coldchain/shared';
import { formatCount, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AllowDialog } from '@/components/dispatch/allow-dialog';
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
 * its truck at the gate (D3). A manager can Allow what a munshi called for (O8-O11): the row then sits in
 * its own group, off the count, with Take back, until the munshi finishes it or the day ends.
 */
export function WaitingCard({
  rows,
  total,
  listed,
  trucks,
  onCheckout,
  onTruckCheckout,
  onCancel,
  onAllow,
}: {
  rows: WaitingRow[];
  /** What still needs a manager: the title and the badge. */
  total: number;
  /** Every row on the list, the allowed ones included: only for "showing the first N". */
  listed: number;
  trucks: TruckInside[];
  onCheckout: (row: WaitingRow) => void;
  onTruckCheckout: (passId: string) => void;
  onCancel: (id: string) => void;
  /** Allow these withdrawals what is listed, or take it back with an empty list. */
  onAllow: (ids: string[], allows: ManagerAllowCode[]) => Promise<void>;
}) {
  const [allowing, setAllowing] = useState<WaitingRow | null>(null);
  // Only a card with no rows at all is hidden: one whose rows are all allowed keeps Take back within reach.
  if (rows.length === 0) return null;
  const today = localIsoDate();
  const before = (r: WaitingRow) => r.outbound_date < today;
  const isAllowed = (r: WaitingRow) => r.allows.length > 0;
  // A called row keeps its place at the top; only an uncalled one goes to the "Booked before today" group.
  const isOld = (r: WaitingRow) => !isAllowed(r) && !r.asked_at && before(r);
  const truckOf = (r: WaitingRow) =>
    r.vehicle_number
      ? trucks.find((t) => checkedOutWhole(t) && normalizePlate(t.vehicle_number) === normalizePlate(r.vehicle_number!))
      : undefined;
  // What an allowance covers: this withdrawal, or every ready line of the truck it rides on.
  const idsOf = (r: WaitingRow) => {
    const truck = truckOf(r);
    return truck ? truck.lines.filter((l) => l.status === 'PENDING' || l.status === 'WEIGHED').map((l) => l.outbound_id) : [r.id];
  };

  const item = (r: WaitingRow) => {
    const truck = truckOf(r);
    const past = before(r);
    const allowed = isAllowed(r);
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
        {allowed && (
          <span className="text-xs text-emerald-800">
            Allowed by {r.allowed_by_name ?? 'a manager'}
            {r.allowed_at ? ` at ${calledAt(r.allowed_at)}` : ''}: {r.allows.map((a) => MANAGER_ALLOW_TEXT[a]).join(', ')}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {/* The munshi could finish it but for what the buyer asked: a manager may allow it. A row that fails a solo rule is theirs to check out. */}
          {!allowed && r.reason_code === null && (
            <Button size="sm" variant="outline" onClick={() => setAllowing(r)}>
              Allow…
            </Button>
          )}
          {allowed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onAllow(idsOf(r), []).catch(() => undefined)}
            >
              Take back
            </Button>
          )}
          {truck ? (
            <Button size="sm" disabled={!truck.ready} onClick={() => onTruckCheckout(truck.gate_pass_id)}>
              Check out truck
            </Button>
          ) : (
            <Button size="sm" onClick={() => onCheckout(r)}>
              Dispatch &amp; Collect
            </Button>
          )}
          {past && !allowed && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onCancel(r.id)}>
              Cancel
            </Button>
          )}
        </span>
      </li>
    );
  };

  const waitingRows = rows.filter((r) => !isAllowed(r));
  const current = waitingRows.filter((r) => !isOld(r));
  const old = waitingRows.filter(isOld);
  const allowedRows = rows.filter(isAllowed);
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
          {allowedRows.length > 0 && (
            <div role="group" aria-label="Allowed — the desk can finish these" className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allowed — the desk can finish these</p>
              <ul className="divide-y">{allowedRows.map(item)}</ul>
            </div>
          )}
          {listed > rows.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing the first {rows.length} of {listed}.
            </p>
          )}
        </CardContent>
      </Card>
      {allowing && (
        <AllowDialog
          open
          onOpenChange={(o) => !o && setAllowing(null)}
          title={`${allowing.dispatch_note_number ?? allowing.lot_number}${allowing.vehicle_number ? ` · ${allowing.vehicle_number}` : ''}`}
          ask={allowing.ask_code}
          onAllow={(allows) => onAllow(idsOf(allowing), allows)}
        />
      )}
    </section>
  );
}
