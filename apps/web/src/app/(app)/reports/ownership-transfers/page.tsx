'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { OwnershipTransferRowType } from '@coldchain/shared';
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

function groupByDate(rows: OwnershipTransferRowType[]) {
  const groups = new Map<string, OwnershipTransferRowType[]>();
  for (const r of rows) {
    if (!groups.has(r.transfer_date)) groups.set(r.transfer_date, []);
    groups.get(r.transfer_date)!.push(r);
  }
  return Array.from(groups.entries());
}

export default function OwnershipTransfersPage() {
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

  const { data, isLoading } = useQuery<PaginatedResult<OwnershipTransferRowType>>({
    queryKey: ['ownership-transfers', user?.facility_id, page, dateFrom, dateTo],
    queryFn: () =>
      apiClientList<OwnershipTransferRowType>(`/v1/reports/ownership-transfers?${qs.toString()}`),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Ownership transfer log requires MANAGER role or higher.</p>
      </div>
    );
  }

  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const grouped = data?.data ? groupByDate(data.data) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Ownership Transfer Log</h1>
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
        <div className="ml-auto text-xs text-gray-500">{total} total transfer{total === 1 ? '' : 's'}</div>
      </div>

      {isLoading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No ownership transfers in range.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, items]) => (
            <div key={date} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b text-sm font-medium text-gray-700">
                {date}
              </div>
              <ul className="divide-y">
                {items.map((t) => (
                  <li key={t.transfer_id} className="px-4 py-3 hover:bg-gray-50">
                    <div className="flex items-center gap-3 text-sm">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          t.type === 'PARTIAL'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {t.type}
                      </span>
                      <button
                        onClick={() => router.push(`/lots/${t.lot_id}`)}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {t.lot_number}
                      </button>
                      {t.child_lot_id && t.child_lot_number && (
                        <>
                          <span className="text-gray-400">→</span>
                          <button
                            onClick={() => router.push(`/lots/${t.child_lot_id}`)}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {t.child_lot_number}
                          </button>
                        </>
                      )}
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-700">
                        <span className="font-medium">{t.from_party_name ?? '—'}</span>
                        <span className="text-gray-400 mx-1">→</span>
                        <span className="font-medium">{t.to_party_name}</span>
                      </span>
                      <span className="ml-auto text-sm text-gray-900 font-medium">
                        {t.quantity_bags.toLocaleString()} bags
                      </span>
                      {t.transfer_price_pkr !== null && (
                        <span className="text-sm text-emerald-700 font-medium">
                          PKR {t.transfer_price_pkr.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {t.notes && (
                      <div className="text-xs text-gray-500 mt-1 italic">{t.notes}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

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
                Page {page} of {totalPages}
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
      )}
    </div>
  );
}
