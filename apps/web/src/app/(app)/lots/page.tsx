'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';

interface Lot {
  id: string;
  lot_number: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  variety_name: string | null;
  marka: string | null;
  chamber_name: string | null;
  quantity_bags: number;
  current_balance_bags: number;
  inbound_date: string;
  days_in_storage: number;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-800',
  SUSPENDED: 'bg-yellow-100 text-yellow-800',
};

export default function LotListPage() {
  const router = useRouter();
  const [lots, setLots] = useState<Lot[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [marka, setMarka] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const fetchLots = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (status) params.set('status', status);
      if (search) params.set('search', search);
      if (marka) params.set('marka', marka);
      const res = await apiClientList<Lot>(`/v1/lots?${params}`);
      setLots(res.data);
      setTotal(res.meta.total);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, [page, status, search, marka]);

  useEffect(() => { fetchLots(); }, [fetchLots]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Lots</h1>
        <Link
          href="/lots/new"
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
        >
          New Inbound
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Search lot number or marka..."
          value={search}
          onChange={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <input
          type="text"
          placeholder="Filter by marka..."
          value={marka}
          onChange={(e) => { setMarka((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm min-w-[160px]"
        />
        <select
          value={status}
          onChange={(e) => { setStatus((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="CLOSED">Closed</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot #</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Owner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commodity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Marka</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Chamber</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Bags</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Inbound</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={10} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : lots.length === 0 ? (
              <tr><td colSpan={10} className="px-6 py-8 text-center text-gray-500">No lots found</td></tr>
            ) : (
              lots.map((lot) => (
                <tr
                  key={lot.id}
                  onClick={() => router.push(`/lots/${lot.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-6 py-4 text-sm font-mono font-medium text-primary-700">{lot.lot_number}</td>
                  <td className="px-6 py-4 text-sm text-gray-900">{lot.owner_party_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {lot.commodity_name}
                    {lot.variety_name && <span className="text-gray-400"> / {lot.variety_name}</span>}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-700">{lot.marka ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{lot.chamber_name}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">{lot.quantity_bags.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right font-medium">{lot.current_balance_bags.toLocaleString()}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{lot.inbound_date}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 text-right">{lot.days_in_storage}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[lot.status] || ''}`}>
                      {lot.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="px-6 py-3 border-t flex items-center justify-between text-sm text-gray-600">
            <span>Showing {((page - 1) * perPage) + 1}-{Math.min(page * perPage, total)} of {total}</span>
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
