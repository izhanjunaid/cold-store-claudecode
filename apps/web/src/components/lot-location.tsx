'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, DoorOpen, FileText, MoveRight, Rows3 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useChambers, useRacks } from '@/hooks/use-reference-data';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RackAllocationEditor,
  toPlacementsPayload,
  allocationTotal,
  type AllocationRow,
} from '@/components/rack-allocation-editor';
import { formatDateTime } from '@/lib/format';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

export interface LotPlacements {
  lot_id: string;
  chamber_id: string;
  chamber_name: string | null;
  current_balance_bags: number;
  placements: { rack_id: string; rack_name: string; bags: number }[];
  unplaced_bags: number;
  warnings?: string[];
}

interface LotMovement {
  id: string;
  movement_type: 'PLACEMENT' | 'RACK_TRANSFER' | 'ROOM_TRANSFER' | 'WITHDRAWAL_PICK';
  from_chamber_name: string | null;
  to_chamber_name: string | null;
  from_rack_name: string | null;
  to_rack_name: string | null;
  bags: number;
  reason: string | null;
  moved_by_name: string | null;
  moved_at: string;
}

export function useLotPlacements(lotId: string) {
  return useQuery({
    queryKey: qk.lots.placements(lotId),
    queryFn: () => apiClient<LotPlacements>(`/v1/lots/${lotId}/placements`),
    enabled: lotId.length > 0,
  });
}

function showWarnings(res: LotPlacements) {
  for (const w of res.warnings ?? []) toast.warning(w);
}

/** Location card on the lot detail page: room → rack chips, move + placement actions. */
export function LotLocationCard({ lotId, canOperate }: { lotId: string; canOperate: boolean }) {
  const queryClient = useQueryClient();
  const { data: loc } = useLotPlacements(lotId);
  const [moveOpen, setMoveOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [slipLoading, setSlipLoading] = useState(false);

  const invalidateLocation = () => {
    queryClient.invalidateQueries({ queryKey: qk.lots.placements(lotId) });
    queryClient.invalidateQueries({ queryKey: qk.lots.movements(lotId) });
    queryClient.invalidateQueries({ queryKey: qk.chambers.all });
    queryClient.invalidateQueries({ queryKey: qk.lots.all });
  };

  const printSlip = async () => {
    setSlipLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/lots/${lotId}/placement-slip`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to fetch placement slip');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Could not generate the placement slip');
    } finally {
      setSlipLoading(false);
    }
  };

  if (!loc) return null;

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <DoorOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          Location
        </CardTitle>
        <div className="flex items-center gap-2">
          {canOperate && (
            <>
              <Button variant="outline" size="sm" onClick={() => setPlaceOpen(true)}>
                <Rows3 className="h-3.5 w-3.5" aria-hidden />
                Edit Placement
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}>
                <MoveRight className="h-3.5 w-3.5" aria-hidden />
                Move
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={printSlip} disabled={slipLoading}>
            <FileText className="h-3.5 w-3.5" aria-hidden />
            {slipLoading ? 'Preparing…' : 'Placement Slip'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{loc.chamber_name ?? 'Room'}</span>
          {loc.placements.length > 0 && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          )}
          {loc.placements.map((p) => (
            <StatusBadge
              key={p.rack_id}
              status={`${p.rack_name} × ${p.bags.toLocaleString()}`}
              tone="neutral"
              raw
              className="tabular-nums"
            />
          ))}
          {loc.unplaced_bags > 0 && (
            <StatusBadge
              status={`Unplaced × ${loc.unplaced_bags.toLocaleString()}`}
              tone="warning"
              raw
              className="tabular-nums"
            />
          )}
          {loc.placements.length === 0 && loc.unplaced_bags === 0 && (
            <span className="text-sm text-muted-foreground">No bags in storage.</span>
          )}
        </div>
      </CardContent>

      {canOperate && moveOpen && (
        <MoveLotDialog
          loc={loc}
          onClose={() => setMoveOpen(false)}
          onMoved={invalidateLocation}
        />
      )}
      {canOperate && placeOpen && (
        <EditPlacementDialog
          loc={loc}
          onClose={() => setPlaceOpen(false)}
          onSaved={invalidateLocation}
        />
      )}
    </Card>
  );
}

function EditPlacementDialog({
  loc,
  onClose,
  onSaved,
}: {
  loc: LotPlacements;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: racks = [] } = useRacks(loc.chamber_id);
  const [rows, setRows] = useState<AllocationRow[]>(
    loc.placements.map((p) => ({ rack_id: p.rack_id, bags: String(p.bags) })),
  );

  const save = useApiMutation<LotPlacements, { placements: { rack_id: string; bags: number }[] }>({
    mutationFn: (body) =>
      apiClient<LotPlacements>(`/v1/lots/${loc.lot_id}/placements`, { method: 'PUT', body }),
    successMessage: () => 'Placement updated',
    onSuccess: (res) => {
      showWarnings(res);
      onSaved();
      onClose();
    },
  });

  const overBalance = allocationTotal(rows) > loc.current_balance_bags;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Placement — {loc.chamber_name}</DialogTitle>
        </DialogHeader>
        <RackAllocationEditor
          racks={racks}
          rows={rows}
          onChange={setRows}
          totalBags={loc.current_balance_bags}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={save.isPending || overBalance}
            onClick={() => save.mutate({ placements: toPlacementsPayload(rows) })}
          >
            {save.isPending ? 'Saving…' : 'Save Placement'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MoveLotDialog({
  loc,
  onClose,
  onMoved,
}: {
  loc: LotPlacements;
  onClose: () => void;
  onMoved: () => void;
}) {
  const { data: racks = [] } = useRacks(loc.chamber_id);
  const { data: chambers = [] } = useChambers();
  const [tab, setTab] = useState<'RACK' | 'ROOM'>('RACK');
  const [fromRackId, setFromRackId] = useState('');
  const [toRackId, setToRackId] = useState('');
  const [bags, setBags] = useState('');
  const [toChamberId, setToChamberId] = useState('');
  const [landingRows, setLandingRows] = useState<AllocationRow[]>([]);
  const [reason, setReason] = useState('');

  const { data: destRacks = [] } = useRacks(tab === 'ROOM' && toChamberId ? toChamberId : undefined);

  const move = useApiMutation<LotPlacements, Record<string, unknown>>({
    mutationFn: (body) =>
      apiClient<LotPlacements>(`/v1/lots/${loc.lot_id}/move`, { method: 'POST', body }),
    successMessage: () => 'Lot moved',
    onSuccess: (res) => {
      showWarnings(res);
      onMoved();
      onClose();
    },
  });

  const fromPlacement = loc.placements.find((p) => p.rack_id === fromRackId);
  const moveBags = parseInt(bags) || 0;
  const rackMoveInvalid =
    !fromRackId || !toRackId || fromRackId === toRackId || moveBags <= 0 ||
    (fromPlacement != null && moveBags > fromPlacement.bags);

  const destChambers = chambers.filter((c) => c.id !== loc.chamber_id);
  const destChamber = chambers.find((c) => c.id === toChamberId);
  const destOverCapacity =
    destChamber != null && loc.current_balance_bags > destChamber.available_capacity_bags;

  const submit = () => {
    if (tab === 'RACK') {
      move.mutate({
        type: 'RACK',
        from_rack_id: fromRackId,
        to_rack_id: toRackId,
        bags: moveBags,
        ...(reason ? { reason } : {}),
      });
    } else {
      const placements = toPlacementsPayload(landingRows);
      move.mutate({
        type: 'ROOM',
        to_chamber_id: toChamberId,
        ...(placements.length > 0 ? { placements } : {}),
        ...(reason ? { reason } : {}),
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Move Lot</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'RACK' | 'ROOM')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="RACK">Between racks</TabsTrigger>
            <TabsTrigger value="ROOM">To another room</TabsTrigger>
          </TabsList>

          <TabsContent value="RACK" className="space-y-3 pt-2">
            {loc.placements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bags are placed on racks yet — use Edit Placement first.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">From rack</label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      value={fromRackId}
                      onChange={(e) => setFromRackId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {loc.placements.map((p) => (
                        <option key={p.rack_id} value={p.rack_id}>
                          {p.rack_name} ({p.bags.toLocaleString()} bags here)
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">To rack</label>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      value={toRackId}
                      onChange={(e) => setToRackId(e.target.value)}
                    >
                      <option value="">Select…</option>
                      {racks
                        .filter((r) => r.id !== fromRackId)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({(r.max_capacity_bags - r.current_occupancy_bags).toLocaleString()} free)
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Bags to move{fromPlacement ? ` (max ${fromPlacement.bags.toLocaleString()})` : ''}
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={fromPlacement?.bags}
                    value={bags}
                    onChange={(e) => setBags(e.target.value)}
                    className="tabular-nums"
                  />
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="ROOM" className="space-y-3 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Destination room</label>
              <select
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={toChamberId}
                onChange={(e) => {
                  setToChamberId(e.target.value);
                  setLandingRows([]);
                }}
              >
                <option value="">Select room…</option>
                {destChambers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.available_capacity_bags.toLocaleString()} bags free)
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                The whole lot ({loc.current_balance_bags.toLocaleString()} bags) moves together.
              </p>
              {destOverCapacity && (
                <p className="mt-1 text-xs font-medium text-destructive">
                  Not enough free capacity in this room.
                </p>
              )}
            </div>
            {toChamberId && destRacks.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Place on arrival (optional)
                </label>
                <RackAllocationEditor
                  racks={destRacks}
                  rows={landingRows}
                  onChange={setLandingRows}
                  totalBags={loc.current_balance_bags}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason (optional)</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. defrost cycle, consolidation…" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={
              move.isPending ||
              (tab === 'RACK' ? rackMoveInvalid : !toChamberId || destOverCapacity)
            }
            onClick={submit}
          >
            {move.isPending ? 'Moving…' : 'Move'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOVEMENT_LABELS: Record<LotMovement['movement_type'], string> = {
  PLACEMENT: 'Placement',
  RACK_TRANSFER: 'Rack transfer',
  ROOM_TRANSFER: 'Room transfer',
  WITHDRAWAL_PICK: 'Picked for dispatch',
};

function movementRoute(m: LotMovement): string {
  if (m.movement_type === 'ROOM_TRANSFER') {
    return `${m.from_chamber_name ?? '?'} → ${m.to_chamber_name ?? '?'}`;
  }
  if (m.movement_type === 'RACK_TRANSFER') {
    return `${m.from_rack_name ?? '?'} → ${m.to_rack_name ?? '?'}`;
  }
  if (m.movement_type === 'WITHDRAWAL_PICK') {
    return `from ${m.from_rack_name ?? '?'}`;
  }
  return m.to_rack_name ? `onto ${m.to_rack_name}` : `off ${m.from_rack_name ?? '?'}`;
}

/** Physical movement history of a lot, newest first. */
export function LotMovementsTimeline({ lotId }: { lotId: string }) {
  const { data: movements = [], isLoading } = useQuery({
    queryKey: qk.lots.movements(lotId),
    queryFn: () => apiClient<LotMovement[]>(`/v1/lots/${lotId}/movements`),
  });

  if (isLoading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading movements…</p>;
  }
  if (movements.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No movements recorded — bags are where they were stacked at inbound.
      </p>
    );
  }
  return (
    <ol className="relative ml-2 space-y-4 border-l pl-4">
      {movements.map((m) => (
        <li key={m.id} className="relative">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="font-medium">{MOVEMENT_LABELS[m.movement_type]}</span>
            <span className="tabular-nums">{m.bags.toLocaleString()} bags</span>
            <span className="text-muted-foreground">{movementRoute(m)}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(m.moved_at)}
            {m.moved_by_name && <> · {m.moved_by_name}</>}
            {m.reason && <> · “{m.reason}”</>}
          </p>
        </li>
      ))}
    </ol>
  );
}
