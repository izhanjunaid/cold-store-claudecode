'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function NewFixedAssetPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('COLD_PLANT');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('0');
  const [method, setMethod] = useState<'SLM' | 'WDV'>('WDV');
  const [usefulLife, setUsefulLife] = useState('');
  const [wdvRate, setWdvRate] = useState('20');
  const [paidFrom, setPaidFrom] = useState('1020');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Only the OWNER can register fixed assets.</p></div>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        asset_name: name,
        asset_category: category,
        purchase_date: purchaseDate,
        purchase_cost_pkr: Number(cost),
        residual_value_pkr: Number(residual) || 0,
        depreciation_method: method,
        paid_from_account_code: paidFrom,
        notes: notes || undefined,
      };
      if (method === 'SLM') payload['useful_life_years'] = Number(usefulLife);
      else payload['wdv_rate_percent'] = Number(wdvRate);

      const created = await apiClient<{ id: string }>('/v1/fixed-assets', {
        method: 'POST',
        body: payload,
      });
      router.push(`/accounting/fixed-assets/${created.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create asset');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Fixed Asset</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Asset Name *</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Bitzer Compressor Unit 1" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded-lg px-3 py-2">
              <option value="COLD_PLANT">Cold Plant (5040 direct cost)</option>
              <option value="BUILDING">Building (6120 indirect)</option>
              <option value="VEHICLE">Vehicle (6130)</option>
              <option value="COMPUTER">Computer (6140)</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Date *</label>
            <input type="date" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Cost (PKR) *</label>
            <input type="number" required min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Residual Value (PKR)</label>
            <input type="number" min="0" step="0.01" value={residual} onChange={(e) => setResidual(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Depreciation Method *</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as any)} className="w-full border rounded-lg px-3 py-2">
              <option value="WDV">WDV (Written-Down Value)</option>
              <option value="SLM">SLM (Straight Line)</option>
            </select>
          </div>
          {method === 'SLM' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Useful Life (Years) *</label>
              <input type="number" required min="0.5" step="0.5" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., 30" />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WDV Rate (%) *</label>
              <input type="number" required min="0.1" max="100" step="0.1" value={wdvRate} onChange={(e) => setWdvRate(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., 20" />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Paid From Account</label>
          <select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className="w-full border rounded-lg px-3 py-2">
            <option value="1020">1020 — Bank Account — Main</option>
            <option value="1010">1010 — Cash on Hand</option>
            <option value="2110">2110 — Bank Loan — Equipment Finance</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2" rows={2} />
        </div>

        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create & Post JE-12'}
          </button>
          <button type="button" onClick={() => router.back()} className="border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </div>
  );
}
