'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Printer, Rows3 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { CapacityBar, capacityPct } from '@/components/capacity-bar';
import { UrduText } from '@/components/ui/urdu-text';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface TemperatureLog {
  id: string;
  temperature_c: number;
  recorded_at: string;
  recorded_by_name?: string;
  source: string;
}
interface Rack {
  id: string;
  name: string;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  position: number;
  is_active: boolean;
  notes: string | null;
}
interface RoomDetail {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  is_active: boolean;
  notes: string | null;
  racks: Rack[];
  unplaced_bags: number;
  temperature_logs: TemperatureLog[];
}
interface RackLot {
  lot_id: string;
  lot_number: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  marka: string | null;
  bags: number;
}

export default function RoomDetailPage() {
  const params = useParams();
  const router = useRouter();
  const chamberId = params['id'] as string;
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = can(user, 'chambers.manage');

  const { data: chamber, isLoading: loading } = useQuery({
    queryKey: qk.chambers.detail(chamberId),
    queryFn: () => apiClient<RoomDetail>(`/v1/chambers/${chamberId}`),
  });

  const [tempInput, setTempInput] = useState('');
  const [selectedRack, setSelectedRack] = useState<Rack | null>(null);
  const [editRack, setEditRack] = useState<Rack | 'new' | null>(null);
  const [labelsLoading, setLabelsLoading] = useState(false);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: qk.chambers.all });
  };

  const logTemp = useApiMutation<unknown, string>({
    mutationFn: (value) =>
      apiClient(`/v1/chambers/${chamberId}/temperature`, {
        method: 'POST',
        body: { temperature_c: parseFloat(value), source: 'MANUAL' },
      }),
    successMessage: () => 'Temperature logged',
    onSuccess: () => {
      setTempInput('');
      refresh();
    },
  });

  const printLabels = async () => {
    setLabelsLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/chambers/${chamberId}/rack-labels`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('label fetch failed');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      toast.error('Could not generate rack labels — does this room have active racks?');
    } finally {
      setLabelsLoading(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!chamber) return <p className="text-destructive">Room not found</p>;

  const pct = capacityPct(chamber.current_occupancy_bags, chamber.max_capacity_bags);

  return (
    <div>
      <PageHeader
        title={chamber.name}
        crumb={chamber.name}
        actions={
          <>
            {chamber.racks.some((r) => r.is_active) && (
              <Button variant="outline" onClick={printLabels} disabled={labelsLoading}>
                <Printer className="h-4 w-4" aria-hidden />
                {labelsLoading ? 'Preparing…' : 'Print Rack Labels'}
              </Button>
            )}
            {canManage && (
              <Button onClick={() => setEditRack('new')}>
                <Plus className="h-4 w-4" aria-hidden />
                Add Rack
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Room Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Commodity</dt><dd className="font-medium">{chamber.commodity_restriction_name || 'Multi-commodity'}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Capacity</dt><dd className="font-medium tabular-nums">{chamber.max_capacity_bags.toLocaleString()} bags</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Racks</dt><dd className="font-medium tabular-nums">{chamber.racks.length}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Temp Range</dt><dd className="font-medium">{chamber.temperature_min_c ?? '?'}°C – {chamber.temperature_max_c ?? '?'}°C</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={chamber.is_active ? 'ACTIVE' : 'INACTIVE'} /></dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-center">
              <span className="text-4xl font-bold tabular-nums">{pct}%</span>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {chamber.current_occupancy_bags.toLocaleString()} / {chamber.max_capacity_bags.toLocaleString()} bags
              </p>
            </div>
            <CapacityBar occupied={chamber.current_occupancy_bags} capacity={chamber.max_capacity_bags} heightClass="h-3" />
            {chamber.unplaced_bags > 0 && (
              <p className="mt-3 text-center text-xs text-amber-700">
                {chamber.unplaced_bags.toLocaleString()} bags in this room are not assigned to a rack yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Rack grid ─────────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Rows3 className="h-4 w-4 text-muted-foreground" aria-hidden />
            Racks
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chamber.racks.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No racks defined yet{canManage ? ' — use "Add Rack" to lay out this room.' : '.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {[...chamber.racks]
                .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
                .map((rack) => {
                  const rackPct = capacityPct(rack.current_occupancy_bags, rack.max_capacity_bags);
                  return (
                    <button
                      key={rack.id}
                      onClick={() => setSelectedRack(rack)}
                      className={cn(
                        'group relative rounded-lg border p-3 text-left transition-shadow hover:shadow-md',
                        !rack.is_active && 'opacity-50',
                      )}
                    >
                      <div className="mb-2 flex items-start justify-between gap-1">
                        <span className="text-lg font-bold">{rack.name}</span>
                        {canManage && (
                          <span
                            role="button"
                            tabIndex={0}
                            className="rounded p-1 opacity-0 transition-opacity hover:bg-secondary group-hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditRack(rack);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.stopPropagation();
                                setEditRack(rack);
                              }
                            }}
                            aria-label={`Edit ${rack.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          </span>
                        )}
                      </div>
                      <CapacityBar occupied={rack.current_occupancy_bags} capacity={rack.max_capacity_bags} className="mb-1.5" />
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {rack.current_occupancy_bags.toLocaleString()} / {rack.max_capacity_bags.toLocaleString()} bags · {rackPct}%
                      </p>
                      {!rack.is_active && <p className="mt-1 text-[10px] uppercase text-muted-foreground">Inactive</p>}
                    </button>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Temperature ───────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Temperature History</CardTitle>
          <div className="flex items-center gap-2">
            <Input type="number" step={0.1} placeholder="Temp °C" value={tempInput} onChange={(e) => setTempInput(e.target.value)} className="h-8 w-28 tabular-nums" />
            <Button size="sm" onClick={() => tempInput && logTemp.mutate(tempInput)} disabled={logTemp.isPending || !tempInput}>
              {logTemp.isPending ? 'Logging…' : 'Log Temp'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {chamber.temperature_logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No temperature readings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Temperature</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chamber.temperature_logs.map((log) => {
                  const inRange =
                    chamber.temperature_min_c !== null && chamber.temperature_max_c !== null
                      ? log.temperature_c >= chamber.temperature_min_c && log.temperature_c <= chamber.temperature_max_c
                      : true;
                  return (
                    <TableRow key={log.id}>
                      <TableCell>{formatDateTime(log.recorded_at)}</TableCell>
                      <TableCell className={cn('font-medium tabular-nums', inRange ? 'text-green-700' : 'text-destructive')}>{log.temperature_c}°C</TableCell>
                      <TableCell>{log.recorded_by_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{log.source}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {chamber.notes && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{chamber.notes}</p></CardContent>
        </Card>
      )}

      {selectedRack && (
        <RackLotsDialog
          rack={selectedRack}
          onClose={() => setSelectedRack(null)}
          onLotClick={(lotId) => router.push(`/lots/${lotId}`)}
        />
      )}
      {canManage && editRack && (
        <RackEditDialog
          chamberId={chamberId}
          rack={editRack === 'new' ? null : editRack}
          nextPosition={chamber.racks.length}
          onClose={() => setEditRack(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

/** Who is stacked on this rack — marka shown large since that's how staff identify stacks. */
function RackLotsDialog({
  rack,
  onClose,
  onLotClick,
}: {
  rack: Rack;
  onClose: () => void;
  onLotClick: (lotId: string) => void;
}) {
  const { data: lots = [], isLoading } = useQuery({
    queryKey: qk.chambers.rackLots(rack.id),
    queryFn: () => apiClient<RackLot[]>(`/v1/racks/${rack.id}/lots`),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Rack {rack.name}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              {rack.current_occupancy_bags.toLocaleString()} / {rack.max_capacity_bags.toLocaleString()} bags
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : lots.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing is placed on this rack.</p>
          ) : (
            <ul className="divide-y">
              {lots.map((l) => (
                <li key={l.lot_id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Button variant="link" className="h-auto shrink-0 p-0 font-mono text-xs" onClick={() => onLotClick(l.lot_id)}>
                    {l.lot_number}
                  </Button>
                  <span className="min-w-0 truncate text-muted-foreground">{l.owner_party_name ?? '—'}</span>
                  <span className="text-muted-foreground">{l.commodity_name ?? '—'}</span>
                  {l.marka && (
                    <UrduText className="rounded bg-secondary px-2 py-0.5 text-xs font-semibold">
                      {l.marka}
                    </UrduText>
                  )}
                  <span className="ml-auto shrink-0 font-medium tabular-nums">{l.bags.toLocaleString()} bags</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RackEditDialog({
  chamberId,
  rack,
  nextPosition,
  onClose,
  onSaved,
}: {
  chamberId: string;
  rack: Rack | null;
  nextPosition: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(rack?.name ?? '');
  const [capacity, setCapacity] = useState(rack ? String(rack.max_capacity_bags) : '');
  const [isActive, setIsActive] = useState(rack?.is_active ?? true);

  const save = useApiMutation<unknown, void>({
    mutationFn: () =>
      rack
        ? apiClient(`/v1/racks/${rack.id}`, {
            method: 'PATCH',
            body: {
              name,
              max_capacity_bags: parseInt(capacity),
              is_active: isActive,
            },
          })
        : apiClient(`/v1/chambers/${chamberId}/racks`, {
            method: 'POST',
            body: { name, max_capacity_bags: parseInt(capacity), position: nextPosition },
          }),
    successMessage: () => (rack ? 'Rack updated' : 'Rack added'),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const valid = name.trim().length > 0 && (parseInt(capacity) || 0) > 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{rack ? `Edit Rack ${rack.name}` : 'Add Rack'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Rack name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. R-1" maxLength={50} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Capacity (bags)</label>
            <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} className="tabular-nums" />
          </div>
          {rack && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
              <span className="text-xs text-muted-foreground">(a rack holding stock cannot be deactivated)</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
