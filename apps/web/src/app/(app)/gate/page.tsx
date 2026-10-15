'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, RefreshCw, Truck } from 'lucide-react';
import { localIsoDate } from '@coldchain/shared';
import { apiClient, apiClientList, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

interface GatePass {
  id: string;
  pass_number: string;
  vehicle_number: string;
  driver_name: string | null;
  status: 'ARRIVED' | 'WEIGHING' | 'CLEARED' | 'CANCELLED';
  related_lot_number: string | null;
  related_outbound_id: string | null;
  related_dispatch_note_number: string | null;
  related_marka?: string | null;
  related_location?: string | null;
  created_at: string;
  turnaround_seconds: number | null;
  /** On the active list only: can this truck be released now? Never carries a bag count. */
  release?: {
    state: 'READY' | 'PAYMENT_PENDING' | 'BILL_DRAFT' | 'NOT_DISPATCHED' | 'NO_BOOKING';
    dispatch_notes: string[];
    outstanding_pkr: number;
    cheque_pending: boolean;
    marka: string | null;
    owner_party_name: string | null;
  };
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  ARRIVED: 'success',
  WEIGHING: 'warning',
  CLEARED: 'muted',
  CANCELLED: 'danger',
};

/** Why a truck can or cannot leave yet, in the words the guard needs. */
function releaseLabel(r: NonNullable<GatePass['release']>): { text: string; tone: 'success' | 'warning' | 'danger' | 'muted' } {
  switch (r.state) {
    case 'READY':
      return { text: 'Paid — ready to leave', tone: 'success' };
    case 'PAYMENT_PENDING':
      return {
        text: `Payment pending — Rs ${r.outstanding_pkr.toLocaleString()}${r.cheque_pending ? ' (cheque not cleared)' : ''}`,
        tone: 'danger',
      };
    case 'BILL_DRAFT':
      return { text: 'Bill not finalized yet', tone: 'warning' };
    case 'NOT_DISPATCHED':
      return { text: 'Not dispatched yet', tone: 'warning' };
    default:
      return { text: 'No dispatch booked', tone: 'muted' };
  }
}

// The truck does not match its dispatch (bag count, plate, or a load nothing was
// dispatched for). A manager may release it anyway with a written reason; anyone
// else recounts or calls one.
const OVERRIDABLE_CODES = new Set([
  'GATE_OUTWARD_COUNT_MISMATCH',
  'GATE_OUTWARD_PLATE_MISMATCH',
  'GATE_OUTWARD_UNMATCHED_LOAD',
]);

// A blank box is "not counted yet"; 0 is a real count (an empty truck).
function parseCount(raw: string): number | null {
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

function relativeTime(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatTurnaround(seconds: number | null): string {
  if (seconds == null || seconds < 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

async function printGatePassReceipt(passId: string) {
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';
  const res = await fetch(`${apiUrl}/v1/gate-passes/${passId}/receipt?format=pdf`, {
    headers: { Authorization: `Bearer ${token}`, 'X-Facility-ID': facilityId ?? '' },
  });
  if (!res.ok) {
    toast.error(`Receipt download failed (${res.status})`);
    return;
  }
  window.open(URL.createObjectURL(await res.blob()), '_blank');
}

export default function GatePassConsolePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canGate = can(user, 'gate_passes.log');
  // Credit release and overriding a gate check are fixed seniority rules, not matrix keys.
  const canManager = !!user && hasMinRole(user.role, 'MANAGER');

  const [passes, setPasses] = useState<GatePass[]>([]);
  const [recentCleared, setRecentCleared] = useState<GatePass[]>([]);
  const [loading, setLoading] = useState(true);

  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [bilty, setBilty] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [outwardModal, setOutwardModal] = useState<GatePass | null>(null);
  const [outwardOutboundId, setOutwardOutboundId] = useState('');
  const [creditAuth, setCreditAuth] = useState(false);
  // The guard's count is blind: the dialog never shows what was dispatched.
  const [outwardCount, setOutwardCount] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  // Once a check is overridable, the reason stays on screen (and is sent with every
  // retry) until the dialog closes — e.g. a plate override that then hits a payment
  // block must keep its reason when the manager adds credit.
  const [overrideOffered, setOverrideOffered] = useState(false);
  const [outwardErr, setOutwardErr] = useState<string | null>(null);
  const [outwardErrCode, setOutwardErrCode] = useState<string | null>(null);
  const [outwardLoading, setOutwardLoading] = useState(false);

  const fetchActive = useCallback(async () => {
    if (!canGate) return;
    try {
      const today = localIsoDate();
      const [active, cleared] = await Promise.all([
        apiClientList<GatePass>('/v1/gate-passes?active=true&page_size=50'),
        apiClientList<GatePass>(`/v1/gate-passes?status=CLEARED&date_from=${today}&page_size=20`),
      ]);
      setPasses(active.data);
      setRecentCleared(cleared.data);
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [canGate]);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, 15000);
    return () => clearInterval(id);
  }, [fetchActive]);

  useEffect(() => {
    if (user && !canGate) router.replace('/dashboard');
  }, [user, canGate, router]);

  if (!canGate) {
    return (
      <div>
        <PageHeader title="Gate Pass Console" />
        <p className="text-muted-foreground">Gate Pass access required.</p>
      </div>
    );
  }

  async function submitInward(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicle.trim()) return;
    setSubmitting(true);
    try {
      await apiClient<GatePass>('/v1/gate-passes/inward', {
        method: 'POST',
        body: {
          vehicle_number: vehicle.trim().toUpperCase(),
          ...(driver.trim() ? { driver_name: driver.trim() } : {}),
          ...(phone.trim() ? { driver_phone: phone.trim() } : {}),
          ...(bilty.trim() ? { bilty_number: bilty.trim() } : {}),
        },
      });
      setVehicle('');
      setDriver('');
      setPhone('');
      setBilty('');
      toast.success('Inward pass logged');
      fetchActive();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log inward');
    } finally {
      setSubmitting(false);
    }
  }

  function openOutward(p: GatePass) {
    setOutwardModal(p);
    setOutwardOutboundId(p.related_outbound_id ?? '');
    setCreditAuth(false);
    setOutwardCount('');
    setOverrideReason('');
    setOverrideOffered(false);
    setOutwardErr(null);
    setOutwardErrCode(null);
  }

  /** `withOverride`: a manager releasing a truck that failed a gate check, with a reason. */
  async function submitOutward(withOverride = false) {
    const declared = parseCount(outwardCount);
    if (!outwardModal || declared == null) return;
    const reason = overrideReason.trim();
    const sendOverride = canManager && (withOverride || (overrideOffered && reason.length >= 3));
    setOutwardLoading(true);
    setOutwardErr(null);
    setOutwardErrCode(null);
    try {
      const cleared = await apiClient<GatePass>(`/v1/gate-passes/${outwardModal.id}/outward`, {
        method: 'POST',
        body: {
          // Naming a withdrawal is a manager's call (the server refuses it from anyone else).
          ...(canManager && outwardOutboundId.trim() ? { outbound_event_id: outwardOutboundId.trim() } : {}),
          ...(creditAuth ? { credit_authorization: true } : {}),
          declared_quantity: declared,
          ...(sendOverride ? { override_reason: reason } : {}),
        },
      });
      setOutwardModal(null);
      setOutwardOutboundId('');
      setCreditAuth(false);
      setOutwardCount('');
      setOverrideReason('');
      toast.success(`Cleared ${cleared.vehicle_number} — TAT ${formatTurnaround(cleared.turnaround_seconds)}`);
      fetchActive();
    } catch (err) {
      const errCode = err instanceof ApiError ? err.code : null;
      setOutwardErrCode(errCode);
      if (errCode && OVERRIDABLE_CODES.has(errCode)) setOverrideOffered(true);
      setOutwardErr(err instanceof Error ? err.message : 'Failed to clear outward');
    } finally {
      setOutwardLoading(false);
    }
  }

  const readyToLeave = passes.filter((p) => p.release?.state === 'READY');
  const countValid = parseCount(outwardCount) != null;
  const outwardBlocked = outwardErrCode === 'GATE_OUTWARD_BLOCKED';
  const outwardMismatch = outwardErrCode != null && OVERRIDABLE_CODES.has(outwardErrCode);

  return (
    <div>
      <PageHeader title="Gate Pass Console" description="Log arriving vehicles and clear outbound dispatches." />

      {readyToLeave.length > 0 && (
        <Card className="mb-6 border-green-300">
          <CardHeader>
            <CardTitle className="text-base">Ready to leave</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {readyToLeave.map((p) => (
                <li key={p.id} className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50/50 p-3">
                  <div className="flex-1">
                    <span className="font-mono text-lg font-bold">{p.vehicle_number}</span>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.release!.owner_party_name ?? '—'}
                      {p.release!.marka && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-semibold">Marka: {p.release!.marka}</span>}
                      <span className="ml-2">{p.release!.dispatch_notes.join(', ')}</span>
                    </div>
                  </div>
                  <Button size="sm" className="h-10 px-5" onClick={() => openOutward(p)}>
                    Release
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Log Arrival */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log Arrival</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInward} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Vehicle number <span className="text-destructive">*</span></Label>
                <Input
                  type="text"
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value)}
                  onBlur={() => setVehicle((v) => v.toUpperCase())}
                  placeholder="LHR-1234"
                  required
                  className="h-12 font-mono text-lg"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Driver name</Label>
                <Input type="text" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Ali Khan" />
              </div>
              <div className="space-y-1.5">
                <Label>Driver phone</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Bilty number</Label>
                <Input type="text" value={bilty} onChange={(e) => setBilty(e.target.value)} placeholder="Optional transporter receipt" />
              </div>
              <Button type="submit" disabled={submitting || !vehicle.trim()} className="h-12 w-full text-base">
                {submitting ? 'Logging…' : 'Log Inward'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Vehicles Currently Inside */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Vehicles Currently Inside</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchActive}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-lg" />
                ))}
              </div>
            ) : passes.length === 0 ? (
              <EmptyState
                icon={Truck}
                title="No vehicles inside"
                hint="Vehicles appear here after you log their arrival."
              />
            ) : (
              <ul className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                {passes.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-bold">{p.vehicle_number}</span>
                        <StatusBadge status={p.status} tone={STATUS_TONE[p.status]} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.pass_number} • {p.driver_name ?? 'unknown driver'} • {relativeTime(p.created_at)}
                        {p.related_lot_number && <span className="ml-1">• Lot {p.related_lot_number}</span>}
                      </div>
                      {p.release && (() => {
                        const r = releaseLabel(p.release);
                        return (
                          <div className="mt-1">
                            <StatusBadge status={r.text} tone={r.tone} raw />
                          </div>
                        );
                      })()}
                      {(p.related_location || p.related_marka) && (
                        <div className="mt-0.5 text-xs">
                          {p.related_location && (
                            <span className="font-medium text-foreground">{p.related_location}</span>
                          )}
                          {p.related_marka && (
                            <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-semibold">
                              Marka: {p.related_marka}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => printGatePassReceipt(p.id)}>
                      Print
                    </Button>
                    <Button size="sm" onClick={() => openOutward(p)}>
                      Clear Outward
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Recently Cleared Today</CardTitle>
        </CardHeader>
        <CardContent>
          {recentCleared.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No clearances yet today.</p>
          ) : (
            <ul className="divide-y">
              {recentCleared.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-mono font-bold">{p.vehicle_number}</span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {p.pass_number} • {p.driver_name ?? '—'}
                  </span>
                  <span className="whitespace-nowrap font-medium text-green-700">TAT {formatTurnaround(p.turnaround_seconds)}</span>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => printGatePassReceipt(p.id)}>
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    Print
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!outwardModal} onOpenChange={(o) => !o && setOutwardModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Outward — {outwardModal?.vehicle_number}</DialogTitle>
            <DialogDescription>
              Pass {outwardModal?.pass_number}
              {outwardModal?.related_dispatch_note_number ? ` • Dispatch ${outwardModal.related_dispatch_note_number}` : ''}
            </DialogDescription>
          </DialogHeader>
          {outwardModal && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="outward-count">
                  Bags counted on truck <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="outward-count"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={outwardCount}
                  onChange={(e) => setOutwardCount(e.target.value)}
                  aria-describedby="outward-count-help"
                  required
                  className="h-12 font-mono text-lg tabular-nums"
                />
                <p id="outward-count-help" className="text-xs text-muted-foreground">
                  Count the bags on the truck. Enter 0 for an empty truck.
                </p>
              </div>
              {canManager && (
                <div className="space-y-1.5">
                  <Label htmlFor="outward-outbound-id">Outbound event ID (optional)</Label>
                  <Input
                    id="outward-outbound-id"
                    value={outwardOutboundId}
                    onChange={(e) => setOutwardOutboundId(e.target.value)}
                    placeholder="Auto-match by vehicle if blank"
                    className="font-mono"
                  />
                </div>
              )}
              {canManager && (
                <label htmlFor="credit-auth" className="flex items-center gap-2 text-sm">
                  <input
                    id="credit-auth"
                    type="checkbox"
                    checked={creditAuth}
                    onChange={(e) => setCreditAuth(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  Authorize on credit (override unpaid invoice)
                </label>
              )}
              {outwardErr && (
                <div
                  role="alert"
                  className={
                    outwardBlocked
                      ? 'space-y-1 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
                      : 'space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800'
                  }
                >
                  <p>{outwardErr}</p>
                  {outwardBlocked && (
                    <p className="font-semibold">
                      {canManager ? 'Tick “Authorize on credit” to release on credit.' : 'Escalate to Manager.'}
                    </p>
                  )}
                  {outwardMismatch && !canManager && <p className="font-semibold">Recount, or call a manager.</p>}
                </div>
              )}
              {(outwardMismatch || overrideOffered) && canManager && (
                <div className="space-y-1.5 rounded-md border border-amber-300 p-3">
                  <Label htmlFor="override-reason">
                    Override reason <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="override-reason"
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="Why this truck may leave anyway"
                    rows={2}
                    maxLength={400}
                  />
                  <p className="text-xs text-muted-foreground">Saved on the gate pass.</p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => submitOutward(true)}
                    disabled={outwardLoading || !countValid || overrideReason.trim().length < 3}
                  >
                    Release anyway
                  </Button>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutwardModal(null)}>
              Cancel
            </Button>
            <Button onClick={() => submitOutward()} disabled={outwardLoading || !countValid}>
              {outwardLoading ? 'Clearing…' : 'Clear Outward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
