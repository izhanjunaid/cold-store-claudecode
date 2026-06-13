'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, RefreshCw } from 'lucide-react';
import { apiClient, apiClientList, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
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
  created_at: string;
  turnaround_seconds: number | null;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'muted' | 'danger'> = {
  ARRIVED: 'success',
  WEIGHING: 'warning',
  CLEARED: 'muted',
  CANCELLED: 'danger',
};

const GATE_ALLOWED_ROLES = ['OWNER', 'MANAGER', 'OPERATOR', 'SECURITY'];

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
  const { user } = useAuthStore();
  const canManager = !!user && hasMinRole(user.role, 'MANAGER');
  const canSecurity = GATE_ALLOWED_ROLES.includes(user?.role ?? '');

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
  const [outwardErr, setOutwardErr] = useState<string | null>(null);
  const [outwardBlocked, setOutwardBlocked] = useState(false);
  const [outwardLoading, setOutwardLoading] = useState(false);

  const fetchActive = useCallback(async () => {
    if (!canSecurity) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
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
  }, [canSecurity]);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, 15000);
    return () => clearInterval(id);
  }, [fetchActive]);

  useEffect(() => {
    if (user && !canSecurity) router.replace('/dashboard');
  }, [user, canSecurity, router]);

  if (!canSecurity) {
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

  async function submitOutward() {
    if (!outwardModal) return;
    setOutwardLoading(true);
    setOutwardErr(null);
    setOutwardBlocked(false);
    try {
      const cleared = await apiClient<GatePass>(`/v1/gate-passes/${outwardModal.id}/outward`, {
        method: 'POST',
        body: {
          ...(outwardOutboundId ? { outbound_event_id: outwardOutboundId } : {}),
          ...(creditAuth ? { credit_authorization: true } : {}),
        },
      });
      setOutwardModal(null);
      setOutwardOutboundId('');
      setCreditAuth(false);
      toast.success(`Cleared ${cleared.vehicle_number} — TAT ${formatTurnaround(cleared.turnaround_seconds)}`);
      fetchActive();
    } catch (err) {
      setOutwardBlocked(err instanceof ApiError && err.code === 'GATE_OUTWARD_BLOCKED');
      setOutwardErr(err instanceof Error ? err.message : 'Failed to clear outward');
    } finally {
      setOutwardLoading(false);
    }
  }

  return (
    <div>
      <PageHeader title="Gate Pass Console" description="Log arriving vehicles and clear outbound dispatches." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Log Arrival */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log Arrival</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitInward} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Vehicle Number <span className="text-destructive">*</span></Label>
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
                <Label>Driver Name</Label>
                <Input type="text" value={driver} onChange={(e) => setDriver(e.target.value)} placeholder="Ali Khan" />
              </div>
              <div className="space-y-1.5">
                <Label>Driver Phone</Label>
                <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0300-1234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Bilty Number</Label>
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
              <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
            ) : passes.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No vehicles currently inside.</p>
            ) : (
              <ul className="space-y-3">
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
                    </div>
                    <Button variant="outline" size="sm" onClick={() => printGatePassReceipt(p.id)}>
                      Print
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setOutwardModal(p);
                        setOutwardOutboundId(p.related_outbound_id ?? '');
                        setCreditAuth(false);
                        setOutwardErr(null);
                        setOutwardBlocked(false);
                      }}
                    >
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
          </DialogHeader>
          {outwardModal && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pass {outwardModal.pass_number}
                {outwardModal.related_dispatch_note_number ? ` • Dispatch ${outwardModal.related_dispatch_note_number}` : ''}
              </p>
              <div className="space-y-1.5">
                <Label>Outbound Event ID (optional)</Label>
                <Input
                  value={outwardOutboundId}
                  onChange={(e) => setOutwardOutboundId(e.target.value)}
                  placeholder="Auto-match by vehicle if blank"
                  className="font-mono"
                />
              </div>
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
                  className={
                    outwardBlocked
                      ? 'rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive'
                      : 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800'
                  }
                >
                  {outwardBlocked ? 'Payment Pending — escalate to Manager' : outwardErr}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutwardModal(null)}>
              Cancel
            </Button>
            <Button onClick={submitOutward} disabled={outwardLoading}>
              {outwardLoading ? 'Clearing…' : 'Clear Outward'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
