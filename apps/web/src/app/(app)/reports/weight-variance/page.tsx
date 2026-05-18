'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { WeightVarianceRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClientList, type PaginatedResult } from '@/lib/api-client';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

const VARIANCE_THRESHOLD_PCT = 2;

export default function WeightVariancePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['MANAGER']!;

  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const perPage = 50;

  const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);

  const { data, isLoading } = useQuery<PaginatedResult<WeightVarianceRowType>>({
    queryKey: ['weight-variance', user?.facility_id, page, dateFrom, dateTo],
    queryFn: () =>
      apiClientList<WeightVarianceRowType>(`/v1/reports/weight-variance?${qs.toString()}`),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Weight variance requires MANAGER role or higher.</p>
      </div>
    );
  }

  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Weight Variance</h1>
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
            onChange={(e) => { setPage(1); setDateFrom((e.target as HTMLInputElement).value); }}
            className="border rounded px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 uppercase mb-1">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => { setPage(1); setDateTo((e.target as HTMLInputElement).value); }}
            className="border rounded px-2 py-1"
          />
        </div>
        <button
          onClick={() => { setDateFrom(''); setDateTo(''); setPage(1); }}
          className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50"
        >
          Clear
        </button>
        <div className="ml-auto text-xs text-gray-500">
          Rows highlighted red have |variance| ≥ {VARIANCE_THRESHOLD_PCT}%
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-3 px-4">Lot #</th>
              <th className="text-left">Owner</th>
              <th className="text-right">Inbound (kg)</th>
              <th className="text-right">Outbound (kg)</th>
              <th className="text-right">Variance (kg)</th>
              <th className="text-right">Variance %</th>
              <th className="text-right">Outbounds</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.data.length ? (
              data.data.map((row) => {
                const flagged = Math.abs(row.variance_pct) >= VARIANCE_THRESHOLD_PCT;
                return (
                  <tr
                    key={row.lot_id}
                    className={`border-t hover:bg-gray-50 cursor-pointer ${flagged ? 'bg-red-50' : ''}`}
                    onClick={() => router.push(`/lots/${row.lot_id}`)}
                  >
                    <td className="py-2 px-4 font-mono text-xs">{row.lot_number}</td>
                    <td>{row.owner_name}</td>
                    <td className="text-right">{row.inbound_kg_prorated.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="text-right">{row.outbound_kg_total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className={`text-right ${flagged ? 'text-red-700 font-medium' : ''}`}>
                      {row.variance_kg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`text-right ${flagged ? 'text-red-700 font-medium' : ''}`}>
                      {row.variance_pct.toFixed(2)}%
                    </td>
                    <td className="text-right text-gray-500">{row.finalized_outbound_count}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No finalized outbounds in range.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded border disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-gray-600">
            Page {page} of {totalPages} ({total} total)
          </span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded border disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
