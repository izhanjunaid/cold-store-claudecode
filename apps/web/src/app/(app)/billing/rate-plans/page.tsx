'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
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
  created_at: string;
}

const RATE_TYPE_LABELS: Record<string, string> = {
  SEASONAL_PER_BAG: 'Seasonal / Bag',
  MONTHLY_PER_BAG: 'Monthly / Bag',
  DAILY_PER_BAG: 'Daily / Bag',
};

export default function RatePlanListPage() {
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>('');

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter) params.set('is_active', activeFilter);
      const qs = params.toString();
      const res = await apiClient<RatePlan[]>(`/v1/rate-plans${qs ? `?${qs}` : ''}`);
      setPlans(res);
    } catch {
      // handled by apiClient
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => { fetchPlans(); }, [fetchPlans]);

  const handleDeactivate = async (id: string) => {
    try {
      await apiClient(`/v1/rate-plans/${id}`, { method: 'DELETE' });
      fetchPlans();
    } catch {
      // handled
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Rate Plans</h1>
        <Link
          href="/billing/rate-plans/new"
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
        >
          New Rate Plan
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4">
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter((e.target as HTMLSelectElement).value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commodity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate (PKR)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Season</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : plans.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No rate plans found</td></tr>
            ) : (
              plans.map((plan) => (
                <tr key={plan.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{plan.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{plan.commodity_name || 'All'}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {RATE_TYPE_LABELS[plan.rate_type] || plan.rate_type}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                    Rs. {plan.rate_amount_pkr.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {plan.season_start_date && plan.season_end_date
                      ? `${plan.season_start_date} - ${plan.season_end_date}`
                      : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${plan.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex gap-2">
                      <Link
                        href={`/billing/rate-plans/${plan.id}/edit`}
                        className="text-primary-600 hover:text-primary-800"
                      >
                        Edit
                      </Link>
                      {plan.is_active && (
                        <button
                          onClick={() => handleDeactivate(plan.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
