'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Commodity {
  id: string;
  name: string;
}

interface FormData {
  name: string;
  commodity_id: string;
  rate_type: string;
  rate_amount_pkr: string;
  season_start_date: string;
  season_end_date: string;
  min_billing_days: string;
}

const EMPTY_FORM: FormData = {
  name: '',
  commodity_id: '',
  rate_type: 'SEASONAL_PER_BAG',
  rate_amount_pkr: '',
  season_start_date: '',
  season_end_date: '',
  min_billing_days: '1',
};

export default function RatePlanCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient<Commodity[]>('/v1/commodities').then(setCommodities).catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    setForm(prev => ({ ...prev, [target.name]: target.value }));
  };

  const isSeasonal = form.rate_type === 'SEASONAL_PER_BAG';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        rate_type: form.rate_type,
        rate_amount_pkr: parseFloat(form.rate_amount_pkr),
        min_billing_days: parseInt(form.min_billing_days) || 1,
      };
      if (form.commodity_id) payload['commodity_id'] = form.commodity_id;
      if (isSeasonal) {
        payload['season_start_date'] = form.season_start_date;
        payload['season_end_date'] = form.season_end_date;
      }

      await apiClient('/v1/rate-plans', { method: 'POST', body: payload });
      router.push('/billing/rate-plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Create Rate Plan</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 max-w-2xl">
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input name="name" value={form.name} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Potato Seasonal 2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commodity</label>
            <select name="commodity_id" value={form.commodity_id} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">All Commodities</option>
              {commodities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Type *</label>
            <select name="rate_type" value={form.rate_type} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="SEASONAL_PER_BAG">Seasonal / Bag</option>
              <option value="MONTHLY_PER_BAG">Monthly / Bag</option>
              <option value="DAILY_PER_BAG">Daily / Bag</option>
            </select>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Season Start *</label>
                <input name="season_start_date" type="date" value={form.season_start_date} onChange={handleChange} required={isSeasonal} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Season End *</label>
                <input name="season_end_date" type="date" value={form.season_end_date} onChange={handleChange} required={isSeasonal} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create Rate Plan'}
          </button>
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
