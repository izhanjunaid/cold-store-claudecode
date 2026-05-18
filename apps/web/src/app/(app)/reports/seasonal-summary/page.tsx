'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { SeasonalSummaryResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

function defaultPeriod() {
  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 6);
  return {
    from: start.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

export default function SeasonalSummaryPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = user?.role === 'OWNER';

  const initial = defaultPeriod();
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });

  const { data, isLoading, refetch } = useQuery<SeasonalSummaryResponseType>({
    queryKey: ['seasonal-summary', user?.facility_id, dateFrom, dateTo],
    queryFn: () => apiClient<SeasonalSummaryResponseType>(`/v1/reports/seasonal-summary?${qs.toString()}`),
    enabled: canView && !!user && !!dateFrom && !!dateTo,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Seasonal summary requires OWNER role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Seasonal Summary</h1>
        <button
          onClick={() => router.push('/reports')}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to reports
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-3 text-sm">
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-1">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)}
            className="border rounded px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo((e.target as HTMLInputElement).value)}
            className="border rounded px-2 py-1"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500 uppercase">Inbound (bags)</div>
              <div className="text-2xl font-semibold mt-1">{data.total_inbound_bags.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500 uppercase">Outbound (bags)</div>
              <div className="text-2xl font-semibold mt-1">{data.total_outbound_bags.toLocaleString()}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500 uppercase">Revenue (PKR)</div>
              <div className="text-2xl font-semibold mt-1 text-emerald-700">
                {data.total_revenue_pkr.toLocaleString()}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500 uppercase">Avg Storage Days</div>
              <div className="text-2xl font-semibold mt-1">
                {data.avg_storage_days !== null ? data.avg_storage_days.toFixed(1) : '—'}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 text-xs uppercase text-gray-500">
              Period: {data.period.from} to {data.period.to}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left py-3 px-4">Commodity</th>
                  <th className="text-right">Inbound (bags)</th>
                  <th className="text-right">Outbound (bags)</th>
                  <th className="text-right">Revenue (PKR)</th>
                </tr>
              </thead>
              <tbody>
                {data.commodities.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gray-500">
                      No activity in period.
                    </td>
                  </tr>
                ) : (
                  data.commodities.map((c) => (
                    <tr key={c.commodity_id} className="border-t">
                      <td className="py-2 px-4">{c.commodity_name}</td>
                      <td className="text-right">{c.inbound_bags.toLocaleString()}</td>
                      <td className="text-right">{c.outbound_bags.toLocaleString()}</td>
                      <td className="text-right text-emerald-700">{c.revenue_pkr.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
