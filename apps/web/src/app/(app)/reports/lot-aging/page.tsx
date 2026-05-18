'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { LotAgingRowType } from '@coldchain/shared';
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

export default function LotAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['MANAGER']!;

  const [page, setPage] = useState(1);
  const perPage = 50;

  const { data, isLoading } = useQuery<PaginatedResult<LotAgingRowType>>({
    queryKey: ['lot-aging', user?.facility_id, page],
    queryFn: () =>
      apiClientList<LotAgingRowType>(
        `/v1/reports/lot-aging?page=${page}&per_page=${perPage}`,
      ),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Lot aging requires MANAGER role or higher.</p>
      </div>
    );
  }

  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Lot Aging</h1>
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-3 px-4">Lot #</th>
              <th className="text-left">Owner</th>
              <th className="text-left">Commodity</th>
              <th className="text-left">Chamber</th>
              <th className="text-right">Bags</th>
              <th className="text-left">Inbound</th>
              <th className="text-right">Days</th>
              <th className="text-right">Threshold</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.data.length ? (
              data.data.map((row) => (
                <tr
                  key={row.lot_id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/lots/${row.lot_id}`)}
                >
                  <td className="py-2 px-4 font-mono text-xs">{row.lot_number}</td>
                  <td>{row.owner_name}</td>
                  <td>{row.commodity_name}</td>
                  <td>{row.chamber_name}</td>
                  <td className="text-right">{row.current_bags}</td>
                  <td>{row.inbound_date}</td>
                  <td
                    className={`text-right font-medium ${
                      row.threshold_exceeded ? 'text-red-700' : 'text-gray-900'
                    }`}
                  >
                    {row.days_in_storage}
                  </td>
                  <td className="text-right text-gray-500">{row.threshold}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  No active lots.
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
