'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, apiClientList, ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface GatePass {
  id: string;
  pass_number: string;
  direction: 'INWARD' | 'OUTWARD';
  vehicle_number: string;
  driver_name: string | null;
  driver_phone: string | null;
  bilty_number: string | null;
  status: 'ARRIVED' | 'WEIGHING' | 'CLEARED' | 'CANCELLED';
  related_lot_id: string | null;
  related_lot_number: string | null;
  related_outbound_id: string | null;
  related_dispatch_note_number: string | null;
  notes: string | null;
  created_at: string;
  cleared_at: string | null;
  turnaround_seconds: number | null;
}

const STATUS_COLORS: Record<string, string> = {
  ARRIVED: 'bg-emerald-100 text-emerald-800',
  WEIGHING: 'bg-amber-100 text-amber-800',
  CLEARED: 'bg-gray-100 text-gray-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  SECURITY: 1,
  OPERATOR: 2,
  ACCOUNTANT: 3,
  MANAGER: 4,
  OWNER: 5,
};

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60000);
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
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const GATE_ALLOWED_ROLES = ['OWNER', 'MANAGER', 'OPERATOR', 'SECURITY'];

async function printGatePassReceipt(passId: string) {
  const token = localStorage.getItem('access_token');
  const facilityId = localStorage.getItem('facility_id');
  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';
  const res = await fetch(`${apiUrl}/v1/gate-passes/${passId}/receipt?format=pdf`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Facility-ID': facilityId ?? '',
    },
  });
  if (!res.ok) {
    alert(`Receipt download failed (${res.status})`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

export default function GatePassConsolePage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const canManager = (ROLE_RANK[user?.role ?? ''] ?? -1) >= ROLE_RANK['MANAGER']!;
  const canSecurity = GATE_ALLOWED_ROLES.includes(user?.role ?? '');

  const [passes, setPasses] = useState<GatePass[]>([]);
  const [recentCleared, setRecentCleared] = useState<GatePass[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inward form
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [bilty, setBilty] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // Outward modal
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
        apiClientList<GatePass>(
          `/v1/gate-passes?status=CLEARED&date_from=${today}&page_size=20`,
        ),
      ]);
      setPasses(active.data);
      setRecentCleared(cleared.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
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
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Gate Pass access required.</p>
      </div>
    );
  }

  async function submitInward(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicle.trim()) return;
    setSubmitting(true);
    setError(null);
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
      setFlash('Inward pass logged');
      setTimeout(() => setFlash(null), 2000);
      fetchActive();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log inward');
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
      const cleared = await apiClient<GatePass>(
        `/v1/gate-passes/${outwardModal.id}/outward`,
        {
          method: 'POST',
          body: {
            ...(outwardOutboundId ? { outbound_event_id: outwardOutboundId } : {}),
            ...(creditAuth ? { credit_authorization: true } : {}),
          },
        },
      );
      setOutwardModal(null);
      setOutwardOutboundId('');
      setCreditAuth(false);
      setFlash(
        `Cleared ${cleared.vehicle_number} — TAT ${formatTurnaround(
          cleared.turnaround_seconds,
        )}`,
      );
      setTimeout(() => setFlash(null), 3000);
      fetchActive();
    } catch (err) {
      const isBlocked =
        err instanceof ApiError && err.code === 'GATE_OUTWARD_BLOCKED';
      setOutwardBlocked(isBlocked);
      setOutwardErr(err instanceof Error ? err.message : 'Failed to clear outward');
    } finally {
      setOutwardLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Gate Pass Console</h1>
        <p className="text-sm text-gray-600">Log arriving vehicles and clear outbound dispatches.</p>
      </div>

      {error && (
        <div className="bg-red-50 text-red-800 p-3 rounded-lg text-sm">{error}</div>
      )}
      {flash && (
        <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-sm">{flash}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — Log Arrival */}
        <form
          onSubmit={submitInward}
          className="bg-white rounded-xl shadow p-6 space-y-4"
        >
          <h2 className="text-lg font-bold text-gray-900">Log Arrival</h2>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Vehicle Number *</span>
            <input
              type="text"
              value={vehicle}
              onChange={(e) => setVehicle((e.target as HTMLInputElement).value)}
              onBlur={() => setVehicle((v) => v.toUpperCase())}
              placeholder="LHR-1234"
              required
              className="mt-1 w-full h-14 px-4 text-xl font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Driver Name</span>
            <input
              type="text"
              value={driver}
              onChange={(e) => setDriver((e.target as HTMLInputElement).value)}
              placeholder="Ali Khan"
              className="mt-1 w-full h-12 px-4 text-base border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Driver Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
              placeholder="0300-1234567"
              className="mt-1 w-full h-12 px-4 text-base border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Bilty Number</span>
            <input
              type="text"
              value={bilty}
              onChange={(e) => setBilty((e.target as HTMLInputElement).value)}
              placeholder="Optional transporter receipt"
              className="mt-1 w-full h-12 px-4 text-base border border-gray-300 rounded-lg focus:outline-none focus:border-emerald-500"
            />
          </label>

          <button
            type="submit"
            disabled={submitting || !vehicle.trim()}
            className="w-full h-16 bg-emerald-600 text-white text-lg font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {submitting ? 'Logging…' : 'LOG INWARD'}
          </button>
        </form>

        {/* RIGHT — Vehicles Currently Inside */}
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-900">Vehicles Currently Inside</h2>
            <button
              onClick={fetchActive}
              className="text-sm text-blue-600 hover:underline"
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm py-12 text-center">Loading…</div>
          ) : passes.length === 0 ? (
            <div className="text-gray-500 text-sm py-12 text-center">
              No vehicles currently inside.
            </div>
          ) : (
            <ul className="space-y-3">
              {passes.map((p) => (
                <li key={p.id} className="border rounded-lg p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-gray-900">
                        {p.vehicle_number}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          STATUS_COLORS[p.status]
                        }`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {p.pass_number} • {p.driver_name ?? 'unknown driver'} •{' '}
                      {relativeTime(p.created_at)}
                      {p.related_lot_number && (
                        <span className="ml-1">• Lot {p.related_lot_number}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => printGatePassReceipt(p.id)}
                    className="border border-gray-300 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-50"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => {
                      setOutwardModal(p);
                      setOutwardOutboundId(p.related_outbound_id ?? '');
                      setCreditAuth(false);
                      setOutwardErr(null);
                      setOutwardBlocked(false);
                    }}
                    className="bg-gray-900 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-800"
                  >
                    Clear Outward
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Recently Cleared Today</h2>
        {recentCleared.length === 0 ? (
          <div className="text-gray-500 text-sm py-6 text-center">
            No clearances yet today.
          </div>
        ) : (
          <ul className="divide-y">
            {recentCleared.map((p) => (
              <li
                key={p.id}
                className="py-2 flex items-center justify-between gap-3 text-sm"
              >
                <span className="font-mono font-bold text-gray-900">
                  {p.vehicle_number}
                </span>
                <span className="text-gray-500 flex-1 truncate">
                  {p.pass_number} • {p.driver_name ?? '—'}
                </span>
                <span className="font-medium text-emerald-700 whitespace-nowrap">
                  TAT {formatTurnaround(p.turnaround_seconds)}
                </span>
                <button
                  onClick={() => printGatePassReceipt(p.id)}
                  className="text-blue-600 hover:underline text-xs"
                >
                  Print
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {outwardModal && (
        <OutwardModal
          pass={outwardModal}
          canManager={canManager}
          outboundId={outwardOutboundId}
          setOutboundId={setOutwardOutboundId}
          creditAuth={creditAuth}
          setCreditAuth={setCreditAuth}
          submit={submitOutward}
          loading={outwardLoading}
          error={outwardErr}
          blocked={outwardBlocked}
          onCancel={() => setOutwardModal(null)}
        />
      )}
    </div>
  );
}

function OutwardModal({
  pass,
  canManager,
  outboundId,
  setOutboundId,
  creditAuth,
  setCreditAuth,
  submit,
  loading,
  error,
  blocked,
  onCancel,
}: {
  pass: GatePass;
  canManager: boolean;
  outboundId: string;
  setOutboundId: (v: string) => void;
  creditAuth: boolean;
  setCreditAuth: (v: boolean) => void;
  submit: () => void;
  loading: boolean;
  error: string | null;
  blocked: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <h3 className="text-lg font-bold text-gray-900">Clear Outward — {pass.vehicle_number}</h3>
        <p className="text-sm text-gray-600">
          Pass {pass.pass_number}
          {pass.related_dispatch_note_number ? ` • Dispatch ${pass.related_dispatch_note_number}` : ''}
        </p>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Outbound Event ID (optional)</span>
          <input
            type="text"
            value={outboundId}
            onChange={(e) => setOutboundId((e.target as HTMLInputElement).value)}
            placeholder="Auto-match by vehicle if blank"
            className="mt-1 w-full h-10 px-3 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </label>

        {canManager && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={creditAuth}
              onChange={(e) => setCreditAuth((e.target as HTMLInputElement).checked)}
            />
            <span>Authorize on credit (override unpaid invoice)</span>
          </label>
        )}

        {error && (
          <div
            className={`p-3 rounded-lg text-sm ${
              blocked ? 'bg-red-50 text-red-800 font-medium' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {blocked ? 'Payment Pending — escalate to Manager' : error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Clearing…' : 'Clear Outward'}
          </button>
        </div>
      </div>
    </div>
  );
}
