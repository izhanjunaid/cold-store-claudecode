'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface OutboundEvent {
  id: string;
  lot_id: string;
  lot_number: string;
  withdrawal_type: 'FULL' | 'PARTIAL';
  quantity_withdrawn_bags: number;
  outbound_weight_kg: number | null;
  outbound_date: string;
  receiving_party_id: string | null;
  receiving_party_name: string | null;
  vehicle_number: string | null;
  dispatch_note_number: string | null;
  status: 'PENDING' | 'WEIGHED' | 'DISPATCHED' | 'CANCELLED' | 'DISPUTED';
  notes: string | null;
  prorated_inbound_weight_kg: number | null;
  weight_variance_pct: number | null;
  created_at: string;
  created_by_name: string;
}

const STATUS_LABELS: Record<OutboundEvent['status'], string> = {
  PENDING: 'Pending Weight',
  WEIGHED: 'Weighed',
  DISPATCHED: 'Dispatched',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Disputed',
};

const STATUS_COLORS: Record<OutboundEvent['status'], string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  WEIGHED: 'bg-blue-100 text-blue-800',
  DISPATCHED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-500',
  DISPUTED: 'bg-red-100 text-red-700',
};

export default function OutboundEventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params['id'] as string;

  const [event, setEvent] = useState<OutboundEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}`);
      setEvent(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleRecordWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    const kg = Number(weightInput);
    if (!kg || kg <= 0) { setError('Enter a valid weight'); return; }
    setSavingWeight(true);
    setError(null);
    try {
      const updated = await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}/weight`, {
        method: 'PATCH',
        body: { outbound_weight_kg: kg },
      });
      setEvent(updated);
      setSuccess('Weight recorded.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record weight');
    } finally {
      setSavingWeight(false);
    }
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    setError(null);
    try {
      const updated = await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}/finalize`, {
        method: 'POST',
        body: {},
      });
      setEvent(updated);
      setSuccess('Dispatch finalized. Lot balance updated.');
      setConfirmFinalize(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  };

  const handlePrintDispatchNote = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      const facilityId = typeof window !== 'undefined' ? localStorage.getItem('facility_id') : null;
      const res = await fetch(`${API_URL}/v1/outbound-events/${eventId}/dispatch-note`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to fetch dispatch note');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dispatch note');
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (error && !event) return <div className="p-6 text-red-600">{error}</div>;
  if (!event) return <div className="p-6 text-red-600">Not found.</div>;

  const isActionable = event.status !== 'DISPATCHED' && event.status !== 'CANCELLED';

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => router.push(`/lots/${event.lot_id}`)} className="text-gray-400 hover:text-gray-600 mt-1">
          &#8592;
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">
              {event.dispatch_note_number ?? '—'}
            </h1>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLORS[event.status]}`}>
              {STATUS_LABELS[event.status]}
            </span>
          </div>
          <div className="text-sm text-gray-500 mt-1">
            Lot:{' '}
            <button
              onClick={() => router.push(`/lots/${event.lot_id}`)}
              className="text-primary-600 hover:underline font-mono"
            >
              {event.lot_number}
            </button>
          </div>
        </div>
      </div>

      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {success}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
      )}

      {/* Detail card */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Dispatch Details</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-gray-500">Withdrawal Type</div>
            <div className="font-medium">{event.withdrawal_type}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Bags Withdrawn</div>
            <div className="font-medium text-lg">{event.quantity_withdrawn_bags.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Outbound Date</div>
            <div className="font-medium">{event.outbound_date}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">Operator</div>
            <div className="font-medium">{event.created_by_name}</div>
          </div>
          {event.receiving_party_name && (
            <div>
              <div className="text-xs text-gray-500">Receiving Party</div>
              <div className="font-medium">{event.receiving_party_name}</div>
            </div>
          )}
          {event.vehicle_number && (
            <div>
              <div className="text-xs text-gray-500">Vehicle</div>
              <div className="font-medium">{event.vehicle_number}</div>
            </div>
          )}
          {event.notes && (
            <div className="col-span-2">
              <div className="text-xs text-gray-500">Notes</div>
              <div className="text-gray-700">{event.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Weight section */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Weight</h2>

        {event.status === 'PENDING' && (
          <form onSubmit={handleRecordWeight} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 mb-1">Outbound Weight (kg) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
                placeholder="e.g. 4850.00"
                required
              />
            </div>
            <button
              type="submit"
              disabled={savingWeight}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {savingWeight ? 'Saving...' : 'Record Weight'}
            </button>
          </form>
        )}

        {event.outbound_weight_kg != null && (
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-gray-500">Outbound Weight</div>
              <div className="font-medium">{event.outbound_weight_kg.toLocaleString()} kg</div>
            </div>
            {event.prorated_inbound_weight_kg != null && (
              <div>
                <div className="text-xs text-gray-500">Prorated Inbound</div>
                <div className="font-medium">{event.prorated_inbound_weight_kg.toLocaleString()} kg</div>
              </div>
            )}
            {event.weight_variance_pct != null && (
              <div>
                <div className="text-xs text-gray-500">Variance</div>
                <div className={`font-semibold ${Math.abs(event.weight_variance_pct) > 5 ? 'text-red-600' : 'text-gray-800'}`}>
                  {event.weight_variance_pct > 0 ? '+' : ''}{event.weight_variance_pct.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        )}

        {event.status === 'PENDING' && event.outbound_weight_kg == null && (
          <p className="text-xs text-gray-400 mt-2">Weight not yet recorded.</p>
        )}
      </div>

      {/* Actions */}
      {isActionable && (
        <div className="flex flex-wrap gap-3">
          {event.status === 'WEIGHED' && (
            <>
              {!confirmFinalize ? (
                <button
                  onClick={() => setConfirmFinalize(true)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  Finalize &amp; Dispatch
                </button>
              ) : (
                <div className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <span className="text-sm text-yellow-800">
                    Confirm dispatch? Lot balance will be updated.
                  </span>
                  <button
                    onClick={handleFinalize}
                    disabled={finalizing}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {finalizing ? 'Finalizing...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmFinalize(false)}
                    className="px-3 py-1 border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          <button
            onClick={handlePrintDispatchNote}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Print Dispatch Note
          </button>
        </div>
      )}

      {event.status === 'DISPATCHED' && (
        <div className="flex gap-3">
          <button
            onClick={handlePrintDispatchNote}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Print Dispatch Note
          </button>
        </div>
      )}
    </div>
  );
}
