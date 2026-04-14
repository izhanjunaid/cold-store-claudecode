'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface RatePlan {
  id: string;
  name: string;
  commodity_id: string | null;
  commodity_name: string | null;
  rate_type: string;
  rate_amount_pkr: number;
  season_start_date: string | null;
  season_end_date: string | null;
  min_billing_days: number;
  is_active: boolean;
}

interface Commodity {
  id: string;
  name: string;
}

interface FormData {
  name: string;
  commodity_id: string;
  rate_amount_pkr: string;
  season_start_date: string;
  season_end_date: string;
  min_billing_days: string;
  is_active: boolean;
}

export default function RatePlanEditPage() {
  const params = useParams();
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [rateType, setRateType] = useState('');
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient<RatePlan>(`/v1/rate-plans/${params['id']}`),
      apiClient<Commodity[]>('/v1/commodities'),
    ])
      .then(([plan, comms]) => {
        setCommodities(comms);
        setRateType(plan.rate_type);
        setForm({
          name: plan.name,
          commodity_id: plan.commodity_id || '',
          rate_amount_pkr: String(plan.rate_amount_pkr),
          season_start_date: plan.season_start_date || '',
          season_end_date: plan.season_end_date || '',
          min_billing_days: String(plan.min_billing_days),
          is_active: plan.is_active,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    setForm(prev => prev ? { ...prev, [target.name]: target.value } : null);
  };

  const isSeasonal = rateType === 'SEASONAL_PER_BAG';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        rate_amount_pkr: parseFloat(form.rate_amount_pkr),
        min_billing_days: parseInt(form.min_billing_days) || 1,
        is_active: form.is_active,
      };
      payload['commodity_id'] = form.commodity_id || null;
      if (isSeasonal) {
        payload['season_start_date'] = form.season_start_date || null;
        payload['season_end_date'] = form.season_end_date || null;
      }

      await apiClient(`/v1/rate-plans/${params['id']}`, { method: 'PATCH', body: payload });
      router.push('/billing/rate-plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rate plan');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-gray-500 p-6">Loading...</div>;
  if (!form) return <div className="text-red-500 p-6">Rate plan not found</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Rate Plan</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 max-w-2xl">
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input name="name" value={form.name} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commodity</label>
            <select name="commodity_id" value={form.commodity_id} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">All Commodities</option>
              {commodities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Type</label>
            <input value={rateType.replace(/_/g, ' ')} disabled className="w-full border rounded-lg px-3 py-2 text-sm bg-gray-100 text-gray-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Amount (PKR) *</label>
            <input name="rate_amount_pkr" type="number" step="0.01" min="0.01" value={form.rate_amount_pkr} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Billing Days</label>
            <input name="min_billing_days" type="number" min="1" value={form.min_billing_days} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
          {isSeasonal && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Season Start</label>
                <input name="season_start_date" type="date" value={form.season_start_date} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Season End</label>
                <input name="season_end_date" type="date" value={form.season_end_date} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm(prev => prev ? { ...prev, is_active: (e.target as HTMLInputElement).checked } : null)}
                className="rounded border-gray-300"
              />
              Active
            </label>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
            {submitting ? 'Saving...' : 'Save Changes'}
          </button>
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
