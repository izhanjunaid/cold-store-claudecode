'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, RefreshCw, Truck } from 'lucide-react';
import { GATE_COUNT_TRIES, localIsoDate } from '@coldchain/shared';
import { apiClient, apiClientList, ApiError } from '@/lib/api-client';
import { formatCount } from '@/lib/format';
import { openPdf } from '@/lib/open-pdf';
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
  /** This pass's wrong counts, oldest first. `expected_quantity` is null for the guard (blind). */
  count_attempts?: {
    declared_quantity: number;
    expected_quantity: number | null;
    counted_by_name: string | null;
    created_at: string;
  }[];
  /** On the active list only: can this truck be released now? Never carries a bag count. */
  release?: {
    state: 'READY' | 'PAYMENT_PENDING' | 'BILL_DRAFT' | 'NOT_DISPATCHED' | 'NO_BOOKING' | 'COUNT_LOCKED';
    dispatch_notes: string[];
    /** Null for the gate guard: an amount stands in for the blind count. Managers get the figure. */
    outstanding_pkr: number | null;
    cheque_pending: boolean;
    marka: string | null;
    owner_party_name: string | null;
    /** Each withdrawal on the truck: a truck may carry several owners' lots, each with its own marka. */
    withdrawals?: { dispatch_note_number: string | null; marka: string | null; owner_party_name: string | null }[];
    /** READY on a standing credit approval rather than payment. A flag only: no amount or ceiling. */
    on_credit?: boolean;
  };
}

/** A row of GET /v1/outbound-events, as far as the dispatch note lookup reads it. */
interface WithdrawalHit {
  id: string;
  dispatch_note_number: string | null;
  vehicle_number: string | null;
  marka: string | null;
  owner_party_name: string | null;
  /** Set once a truck has carried it out. */
  gate_pass_id: string | null;
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
      return { text: r.on_credit ? 'Credit approved — ready to leave' : 'Paid — ready to leave', tone: 'success' };
    case 'PAYMENT_PENDING':
      return {
        // The guard gets no amount (null): the fact only.
        text: `Payment pending${r.outstanding_pkr == null ? '' : ` — Rs ${r.outstanding_pkr.toLocaleString()}`}${
          r.cheque_pending ? ' (cheque not cleared)' : ''
        }`,
        tone: 'danger',
      };
    case 'BILL_DRAFT':
      return { text: 'Bill not finalized yet', tone: 'warning' };
    case 'NOT_DISPATCHED':
      return { text: 'Not dispatched yet', tone: 'warning' };
    case 'COUNT_LOCKED':
      return { text: 'Counts did not match — call a manager', tone: 'danger' };
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

/** How many tries a refused count leaves: the API's `error.details.tries_left` (a number of tries, never of bags). */
function triesLeftOf(err: unknown): number | null {
  const body = err instanceof ApiError ? (err.details as { details?: { tries_left?: unknown } } | undefined) : undefined;
  const n = body?.details?.tries_left;
  return typeof n === 'number' ? n : null;
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
  try {
    await openPdf(`/v1/gate-passes/${passId}/receipt?format=pdf`, 'gate receipt'); // its tab opens on the click
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not open the gate receipt');
  }
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
  // A manager may name the withdrawal by its dispatch note number (docs/28 D9): what is typed, the
  // dispatched withdrawal found for it, and why none was.
  const [dnText, setDnText] = useState('');
  const [dnMatch, setDnMatch] = useState<WithdrawalHit | null>(null);
  const [dnNote, setDnNote] = useState<string | null>(null);
  const [dnLooking, setDnLooking] = useState(false);
  // Which lookup may still answer: an answer from an older one (or for an edited box) is dropped.
  const dnSeq = useRef(0);
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
  // Tries the truck has left after a refused count (null: the refusal said nothing about tries).
  const [outwardTriesLeft, setOutwardTriesLeft] = useState<number | null>(null);
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
    // No pre-fill from the pass's stored link: only the manager's own typed choice names a withdrawal.
    dropLookup();
    setDnText('');
    setDnMatch(null);
    setDnNote(null);
    setCreditAuth(false);
    setOutwardCount('');
    setOverrideReason('');
    setOverrideOffered(false);
    setOutwardErr(null);
    setOutwardErrCode(null);
    setOutwardTriesLeft(null);
  }

  /**
   * Find the dispatched withdrawal a typed dispatch note number names. The search route matches a
   * substring (DN-…-0009 also finds DN-…-00090), so only the exact number counts.
   */
  async function findDispatchNote() {
    const dn = dnText.trim().toUpperCase();
    if (!dn) return;
    const seq = ++dnSeq.current;
    setDnLooking(true);
    setDnMatch(null);
    setDnNote(null);
    try {
      const { data } = await apiClientList<WithdrawalHit>(
        `/v1/outbound-events?status=DISPATCHED&search=${encodeURIComponent(dn)}&page_size=10`,
      );
      if (seq !== dnSeq.current) return; // the box was edited, or searched again, since: this answer is old
      const hit = data.find((r) => (r.dispatch_note_number ?? '').toUpperCase() === dn);
      if (!hit) setDnNote('No dispatched withdrawal with that dispatch note number.');
      else if (hit.gate_pass_id) setDnNote('That dispatch note already left on another truck.');
      else setDnMatch(hit);
    } catch (err) {
      if (seq !== dnSeq.current) return;
      setDnNote(err instanceof Error ? err.message : 'Could not look up the dispatch note');
    } finally {
      if (seq === dnSeq.current) setDnLooking(false);
    }
  }

  /** The box changed (or the dialog did): an answer still on its way is for something else now. */
  function dropLookup() {
    dnSeq.current += 1;
    setDnLooking(false);
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
    setOutwardTriesLeft(null);
    try {
      const cleared = await apiClient<GatePass>(`/v1/gate-passes/${outwardModal.id}/outward`, {
        method: 'POST',
        body: {
          // Naming a withdrawal is a manager's call (the server refuses it from anyone else).
          ...(canManager && found ? { outbound_event_id: found.id } : {}),
          ...(creditAuth ? { credit_authorization: true } : {}),
          declared_quantity: declared,
          ...(sendOverride ? { override_reason: reason } : {}),
        },
      });
      setOutwardModal(null);
      setDnText('');
      setDnMatch(null);
      setCreditAuth(false);
      setOutwardCount('');
      setOverrideReason('');
      toast.success(`Cleared ${cleared.vehicle_number} — TAT ${formatTurnaround(cleared.turnaround_seconds)}`);
      fetchActive();
    } catch (err) {
      const errCode = err instanceof ApiError ? err.code : null;
      setOutwardErrCode(errCode);
      setOutwardTriesLeft(triesLeftOf(err));
      if (errCode && OVERRIDABLE_CODES.has(errCode)) setOverrideOffered(true);
      // A booking not yet checked out holds the truck whatever a manager writes: drop an override
      // that an earlier miss on the count offered.
      if (errCode === 'GATE_OUTWARD_NOT_DISPATCHED') setOverrideOffered(false);
      setOutwardErr(err instanceof Error ? err.message : 'Failed to clear outward');
    } finally {
      setOutwardLoading(false);
    }
  }

  const readyToLeave = passes.filter((p) => p.release?.state === 'READY');
  const countValid = parseCount(outwardCount) != null;
  const outwardBlocked = outwardErrCode === 'GATE_OUTWARD_BLOCKED';
  // The withdrawal found for what the box says NOW. A lookup that was answered after the box was edited
  // (or the dialog reopened) found something else, and must not name it.
  const found =
    dnMatch && (dnMatch.dispatch_note_number ?? '').toUpperCase() === dnText.trim().toUpperCase() ? dnMatch : null;
  // A dispatch note was typed but is not (or no longer) a withdrawal that was found: releasing waits.
  const dnPending = canManager && dnText.trim() !== '' && !found;
  const outwardHold = outwardErrCode === 'GATE_OUTWARD_NOT_DISPATCHED';
  // Three counts have not matched: only a manager releases this truck, so the guard cannot try again.
  const outwardLocked = outwardErrCode === 'GATE_OUTWARD_COUNT_LOCKED';
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
                    {p.release!.withdrawals?.length ? (
                      // One line per withdrawal: the guard matches each owner's bags by their marka.
                      <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                        {p.release!.withdrawals.map((w, i) => (
                          <li key={w.dispatch_note_number ?? i}>
                            <span className="font-mono">{w.dispatch_note_number ?? '—'}</span>
                            {w.marka && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-semibold">Marka: {w.marka}</span>}
                            <span className="ml-2">{w.owner_party_name ?? '—'}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {p.release!.owner_party_name ?? '—'}
                        {p.release!.marka && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 font-semibold">Marka: {p.release!.marka}</span>}
                        <span className="ml-2">{p.release!.dispatch_notes.join(', ')}</span>
                      </div>
                    )}
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
              {canManager && (outwardModal.count_attempts?.length ?? 0) > 0 && (
                <div className="rounded-md border border-amber-300 p-3 text-sm">
                  <p className="font-medium">Earlier counts on this pass</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {outwardModal.count_attempts!.map((a) => (
                      <li key={a.created_at}>
                        {relativeTime(a.created_at)} — {a.counted_by_name ?? 'Someone'} counted {formatCount(a.declared_quantity)}
                        {a.expected_quantity != null ? `, dispatch said ${formatCount(a.expected_quantity)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {canManager && (
                <div className="space-y-1.5">
                  <Label htmlFor="outward-dn">Dispatch note number (optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="outward-dn"
                      value={dnText}
                      onChange={(e) => {
                        // An edited number no longer names what was found for the old one.
                        dropLookup();
                        setDnText(e.target.value);
                        setDnMatch(null);
                        setDnNote(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault(); // looks the number up; releasing is the button's job
                        void findDispatchNote();
                      }}
                      placeholder="Match the truck by its plate if blank"
                      className="font-mono"
                    />
                    <Button type="button" variant="outline" onClick={() => void findDispatchNote()} disabled={!dnText.trim() || dnLooking}>
                      Find
                    </Button>
                  </div>
                  {found && (
                    <p className="text-xs text-muted-foreground">
                      {found.dispatch_note_number} · {found.owner_party_name ?? '—'} · {found.marka ?? '—'} · {found.vehicle_number ?? '—'}
                    </p>
                  )}
                  {dnNote && <p className="text-xs text-destructive">{dnNote}</p>}
                  {dnPending && !dnLooking && (
                    <p className="text-xs text-amber-700">Find the dispatch note, or clear the box.</p>
                  )}
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
                  {outwardMismatch && !canManager && (
                    <p className="font-semibold">
                      {outwardTriesLeft == null
                        ? 'Recount, or call a manager.'
                        : outwardTriesLeft > 0
                          ? `Try ${GATE_COUNT_TRIES - outwardTriesLeft} of ${GATE_COUNT_TRIES}, recount.`
                          : `Try ${GATE_COUNT_TRIES} of ${GATE_COUNT_TRIES} — call a manager.`}
                    </p>
                  )}
                  {outwardLocked && <p className="font-semibold">Call a manager.</p>}
                  {outwardHold && <p className="font-semibold">Send the truck back to the desk.</p>}
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
                    disabled={outwardLoading || !countValid || overrideReason.trim().length < 3 || dnPending}
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
            <Button onClick={() => submitOutward()} disabled={outwardLoading || !countValid || outwardLocked || dnPending}>
              {outwardLoading ? 'Clearing…' : 'Clear Outward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
