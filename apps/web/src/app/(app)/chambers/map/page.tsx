'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { UrduText } from '@/components/ui/urdu-text';
import { cn } from '@/lib/utils';

interface Rack {
  id: string;
  name: string;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  is_active: boolean;
  position: number;
}
interface Chamber {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  rack_count: number;
  last_temperature: { temperature_c: number } | null;
}
interface RoomDetail extends Chamber {
  racks: Rack[];
  unplaced_bags: number;
}
interface LotSummary {
  id: string;
  lot_number: string;
  owner_party_name?: string | null;
  commodity_name?: string | null;
  marka?: string | null;
  current_balance_bags: number;
}
interface RackLot {
  lot_id: string;
  lot_number: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  marka: string | null;
  bags: number;
}

function fillTier(pct: number) {
  if (pct >= 90) return { bg: 'bg-red-500', text: 'text-white', border: 'border-red-700', label: 'Full' };
  if (pct >= 70) return { bg: 'bg-amber-400', text: 'text-gray-900', border: 'border-amber-600', label: 'Busy' };
  if (pct > 0) return { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-700', label: 'Open' };
  return { bg: 'bg-secondary', text: 'text-muted-foreground', border: 'border-border', label: 'Empty' };
}

export default function RoomMapPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = hasMinRole(user?.role, 'MANAGER');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: chambers = [], isLoading: loading } = useQuery({
    queryKey: qk.chambers.list({ view: 'map' }),
    queryFn: () => apiClient<Chamber[]>('/v1/chambers'),
    enabled: canView,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Room Map" />
        <p className="text-muted-foreground">Room map requires MANAGER role or higher.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Room Map"
        description="Fill-level overview across all rooms — click a room to see its racks"
        actions={
          <Button variant="outline" onClick={() => router.push('/chambers')}>
            Back to list
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 py-3 text-xs">
          <span className="font-medium text-muted-foreground">Fill level:</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-emerald-500" /> Open (1–69%)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-amber-400" /> Busy (70–89%)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-red-500" /> Full (90%+)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border bg-secondary" /> Empty</span>
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="aspect-square w-full rounded-lg" />
          ))}
        </div>
      ) : chambers.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No rooms configured.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {chambers.map((c) => {
            const pct = c.max_capacity_bags > 0 ? Math.round((c.current_occupancy_bags / c.max_capacity_bags) * 100) : 0;
            const tier = fillTier(pct);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  'relative flex aspect-square flex-col justify-between rounded-lg border-2 p-3 text-left transition-opacity hover:opacity-90',
                  tier.border,
                  tier.bg,
                  tier.text,
                  selectedId === c.id && 'ring-2 ring-ring ring-offset-2',
                )}
              >
                <div>
                  <div className="text-base font-semibold">{c.name}</div>
                  <div className="mt-0.5 text-xs opacity-90">{c.commodity_restriction_name ?? 'Multi'}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold leading-none tabular-nums">{pct}%</div>
                  <div className="mt-1 text-xs opacity-90 tabular-nums">
                    {c.current_occupancy_bags.toLocaleString()} / {c.max_capacity_bags.toLocaleString()} bags
                  </div>
                  <div className="mt-0.5 text-xs opacity-80">
                    {tier.label}
                    {c.rack_count > 0 && <> · {c.rack_count} racks</>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedId && (
        <RoomDrillDownDialog
          chamberId={selectedId}
          onClose={() => setSelectedId(null)}
          onOpenRoom={() => router.push(`/chambers/${selectedId}`)}
          onOpenLot={(lotId) => router.push(`/lots/${lotId}`)}
        />
      )}
    </div>
  );
}

/** Drill-down: the room's racks as a mini-heatmap; click a rack to see whose stacks sit on it. */
function RoomDrillDownDialog({
  chamberId,
  onClose,
  onOpenRoom,
  onOpenLot,
}: {
  chamberId: string;
  onClose: () => void;
  onOpenRoom: () => void;
  onOpenLot: (lotId: string) => void;
}) {
  const [rackId, setRackId] = useState<string | null>(null);

  const { data: room } = useQuery({
    queryKey: qk.chambers.detail(chamberId),
    queryFn: () => apiClient<RoomDetail>(`/v1/chambers/${chamberId}`),
  });

  const { data: roomLots = [], isLoading: roomLotsLoading } = useQuery({
    queryKey: qk.lots.list({ chamber_id: chamberId, status: 'ACTIVE', view: 'map' }),
    queryFn: () =>
      apiClient<{ data: LotSummary[] } | LotSummary[]>(`/v1/lots?chamber_id=${chamberId}&status=ACTIVE&per_page=200`).then(
        (res) => (Array.isArray(res) ? res : res.data ?? []),
      ),
    enabled: rackId === null,
  });

  const { data: rackLots = [], isLoading: rackLotsLoading } = useQuery({
    queryKey: qk.chambers.rackLots(rackId ?? 'none'),
    queryFn: () => apiClient<RackLot[]>(`/v1/racks/${rackId}/lots`),
    enabled: rackId !== null,
  });

  const racks = (room?.racks ?? []).filter((r) => r.is_active);
  const selectedRack = racks.find((r) => r.id === rackId);
  const isLoading = rackId ? rackLotsLoading : roomLotsLoading;

  const rows: { id: string; lot_number: string; owner: string | null; commodity: string | null; marka: string | null; bags: number }[] =
    rackId
      ? rackLots.map((l) => ({ id: l.lot_id, lot_number: l.lot_number, owner: l.owner_party_name, commodity: l.commodity_name, marka: l.marka, bags: l.bags }))
      : roomLots.map((l) => ({ id: l.id, lot_number: l.lot_number, owner: l.owner_party_name ?? null, commodity: l.commodity_name ?? null, marka: l.marka ?? null, bags: l.current_balance_bags }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{room?.name ?? 'Room'}</DialogTitle>
        </DialogHeader>

        {room && (
          <p className="text-sm text-muted-foreground">
            {room.current_occupancy_bags.toLocaleString()} of {room.max_capacity_bags.toLocaleString()} bags
            {room.last_temperature && <span className="ml-2">· {room.last_temperature.temperature_c}°C</span>}
          </p>
        )}

        {racks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              className={cn(
                'rounded-md border px-2.5 py-1 text-xs font-medium',
                rackId === null ? 'border-primary bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground',
              )}
              onClick={() => setRackId(null)}
            >
              All lots
            </button>
            {[...racks]
              .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
              .map((r) => {
                const pct = r.max_capacity_bags > 0 ? Math.round((r.current_occupancy_bags / r.max_capacity_bags) * 100) : 0;
                const tier = fillTier(pct);
                return (
                  <button
                    key={r.id}
                    onClick={() => setRackId(r.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium tabular-nums',
                      tier.bg,
                      tier.text,
                      tier.border,
                      rackId === r.id && 'ring-2 ring-ring ring-offset-1',
                    )}
                  >
                    {r.name} · {pct}%
                  </button>
                );
              })}
            {room != null && room.unplaced_bags > 0 && (
              <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 tabular-nums">
                Unplaced · {room.unplaced_bags.toLocaleString()} bags
              </span>
            )}
          </div>
        )}

        <div className="max-h-[45vh] overflow-y-auto">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading lots…</p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {rackId ? `Nothing is placed on ${selectedRack?.name ?? 'this rack'}.` : 'No active lots in this room.'}
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((lot) => (
                <li key={lot.id} className="flex items-center gap-3 py-2 text-sm">
                  <Button variant="link" className="h-auto shrink-0 p-0 font-mono text-xs" onClick={() => onOpenLot(lot.id)}>
                    {lot.lot_number}
                  </Button>
                  <span className="min-w-0 truncate text-muted-foreground">{lot.owner ?? '—'}</span>
                  <span className="text-muted-foreground">{lot.commodity ?? '—'}</span>
                  {lot.marka && (
                    <UrduText className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">{lot.marka}</UrduText>
                  )}
                  <span className="ml-auto shrink-0 font-medium tabular-nums">{lot.bags.toLocaleString()} bags</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onOpenRoom}>
            Room Details
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
