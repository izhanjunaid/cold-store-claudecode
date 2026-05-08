'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface FixedAssetSummary {
  id: string;
  asset_number: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  purchase_cost_pkr: number;
  accumulated_depreciation_pkr: number;
  net_book_value_pkr: number;
  depreciation_method: string;
  status: string;
  book_type: string;
}

const STATUS_COLORS: Record<string, string> = {
  PLANNED: 'bg-gray-100 text-gray-800',
  PURCHASED: 'bg-blue-100 text-blue-800',
  IN_SERVICE: 'bg-green-100 text-green-800',
  DISPOSED: 'bg-red-100 text-red-800',
  WRITTEN_OFF: 'bg-red-100 text-red-800',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function FixedAssetListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [assets, setAssets] = useState<FixedAssetSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const canAccess = !user || (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;

  const fetchAssets = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      const res = await apiClientList<FixedAssetSummary>(`/v1/fixed-assets?${params}`);
      setAssets(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, categoryFilter, canAccess]);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  if (!canAccess) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">No permission.</p></div>;
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fixed Assets</h1>
        {canCreate && (
          <Link href="/accounting/fixed-assets/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            + New Asset
          </Link>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="PURCHASED">Purchased</option>
          <option value="IN_SERVICE">In Service</option>
          <option value="DISPOSED">Disposed</option>
          <option value="WRITTEN_OFF">Written Off</option>
        </select>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Categories</option>
          <option value="COLD_PLANT">Cold Plant</option>
          <option value="BUILDING">Building</option>
          <option value="VEHICLE">Vehicle</option>
          <option value="COMPUTER">Computer</option>
          <option value="OTHER">Other</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset #</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Purchase Date</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost (PKR)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Accum. Depr.</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">NBV (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-gray-500">No assets yet</td></tr>
            ) : (
              assets.map((a) => (
                <tr key={a.id} onClick={() => router.push(`/accounting/fixed-assets/${a.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">{a.asset_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{a.asset_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{a.asset_category}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{a.purchase_date}</td>
                  <td className="px-4 py-3 text-sm text-right">{a.purchase_cost_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right text-orange-700">{a.accumulated_depreciation_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{a.net_book_value_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{a.depreciation_method}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[a.status]}`}>{a.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t flex items-center justify-between text-sm text-gray-600">
            <span>Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
