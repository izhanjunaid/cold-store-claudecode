'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Lot {
  id: string;
  lot_number: string;
  status: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  current_balance_bags: number;
}

interface Party {
  id: string;
  name: string;
  party_type: string;
  is_active: boolean;
}

interface FormState {
  withdrawal_type: 'FULL' | 'PARTIAL';
  quantity_withdrawn_bags: string;
  outbound_date: string;
  receiving_party_id: string;
  vehicle_number: string;
  notes: string;
}

export default function WithdrawPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;

  const [lot, setLot] = useState<Lot | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    withdrawal_type: 'FULL',
    quantity_withdrawn_bags: '',
    outbound_date: new Date().toISOString().slice(0, 10),
    receiving_party_id: '',
    vehicle_number: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lotRes = await apiClient<Lot>(`/v1/lots/${lotId}`);
      setLot(lotRes);

      const partyRes = await apiClient<{ data: Party[] } | Party[]>(
        '/v1/parties?is_active=true&per_page=100',
      );
      const list = Array.isArray(partyRes) ? partyRes : partyRes.data;
      setParties(list.filter((p) => p.is_active));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!lot) return;

    if (form.withdrawal_type === 'PARTIAL') {
      const qty = Number(form.quantity_withdrawn_bags);
      if (!qty || qty <= 0) { setError('Enter number of bags to withdraw'); return; }
      if (qty >= lot.current_balance_bags) {
        setError(`Partial quantity must be less than current balance (${lot.current_balance_bags}). Use FULL to withdraw the whole lot.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const qty =
        form.withdrawal_type === 'FULL'
          ? lot.current_balance_bags
          : Number(form.quantity_withdrawn_bags);

      const body: Record<string, unknown> = {
        lot_id: lotId,
        withdrawal_type: form.withdrawal_type,
        quantity_withdrawn_bags: qty,
        outbound_date: form.outbound_date,
      };
      if (form.receiving_party_id) body['receiving_party_id'] = form.receiving_party_id;
      if (form.vehicle_number) body['vehicle_number'] = form.vehicle_number;
      if (form.notes) body['notes'] = form.notes;

      const res = await apiClient<{ id: string }>('/v1/outbound-events', {
        method: 'POST',
        body,
      });

      router.push(`/outbound-events/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-6 text-gray-500">Loading...</div>;
  if (!lot) return <div className="p-6 text-red-600">Lot not found.</div>;
  if (lot.status !== 'ACTIVE') {
    return (
      <div className="p-6">
        <p className="text-red-600 mb-4">Lot is {lot.status}; withdrawals require ACTIVE status.</p>
        <button onClick={() => router.push(`/lots/${lotId}`)} className="text-primary-600 hover:underline text-sm">
          Back to Lot
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push(`/lots/${lotId}`)} className="text-gray-400 hover:text-gray-600">
          &#8592;
        </button>
        <h1 className="text-2xl font-bold text-gray-900">New Withdrawal</h1>
      </div>

      <div className="bg-gray-50 border rounded-lg p-4 mb-6 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase text-gray-500 tracking-wide">Lot</div>
            <div className="font-mono font-medium">{lot.lot_number}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500 tracking-wide">Owner</div>
            <div className="font-medium">{lot.owner_party_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500 tracking-wide">Commodity</div>
            <div>{lot.commodity_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500 tracking-wide">Current Balance</div>
            <div className="font-medium text-blue-700">{lot.current_balance_bags.toLocaleString()} bags</div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-5">
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Withdrawal Type</label>
          <div className="flex gap-3">
            {(['FULL', 'PARTIAL'] as const).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setForm({ ...form, withdrawal_type: t })}
                className={`px-4 py-2 rounded-lg border text-sm font-medium ${
                  form.withdrawal_type === t
                    ? 'bg-primary-600 text-white border-primary-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t === 'FULL' ? `Full (${lot.current_balance_bags} bags)` : 'Partial'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {form.withdrawal_type === 'FULL'
              ? 'All remaining bags dispatched; lot will close after finalization.'
              : 'Specify how many bags to withdraw; remaining stay in storage.'}
          </p>
        </div>

        {form.withdrawal_type === 'PARTIAL' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bags to Withdraw *{' '}
              <span className="text-gray-400 font-normal">(max {lot.current_balance_bags - 1})</span>
            </label>
            <input
              type="number"
              min="1"
              max={lot.current_balance_bags - 1}
              value={form.quantity_withdrawn_bags}
              onChange={(e) => setForm({ ...form, quantity_withdrawn_bags: e.target.value })}
              className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Outbound Date *</label>
            <input
              type="date"
              value={form.outbound_date}
              onChange={(e) => setForm({ ...form, outbound_date: e.target.value })}
              className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
            <input
              type="text"
              maxLength={20}
              value={form.vehicle_number}
              onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
              className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
              placeholder="Optional"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receiving Party</label>
          <select
            value={form.receiving_party_id}
            onChange={(e) => setForm({ ...form, receiving_party_id: e.target.value })}
            className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
          >
            <option value="">— Optional —</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.party_type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full border-gray-300 rounded-lg shadow-sm text-sm"
            placeholder="Optional"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Withdrawal'}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/lots/${lotId}`)}
            className="px-5 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
