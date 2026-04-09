'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Party {
  id: string;
  name: string;
  name_urdu: string | null;
  party_type: string;
  phone_primary: string;
  credit_limit_pkr: number | null;
  is_active: boolean;
}

interface ListResponse {
  data: Party[];
  meta: { page: number; per_page: number; total: number };
}

const PARTY_TYPE_COLORS: Record<string, string> = {
  FARMER: 'bg-green-100 text-green-800',
  TRADER: 'bg-blue-100 text-blue-800',
  ARHTI: 'bg-purple-100 text-purple-800',
  BUYER: 'bg-orange-100 text-orange-800',
  OTHER: 'bg-gray-100 text-gray-800',
};

export default function PartyListPage() {
  const router = useRouter();
  const [parties, setParties] = useState<Party[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const fetchParties = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      if (activeFilter) params.set('is_active', activeFilter);
      const res = await apiClient<ListResponse>(`/v1/parties?${params}`);
      setParties(res.data);
      setTotal(res.meta.total);
    } catch {
      // handled by apiClient
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, activeFilter]);

  useEffect(() => { fetchParties(); }, [fetchParties]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Parties</h1>
        <Link
          href="/parties/new"
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
        >
          New Party
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Search name or phone..."
          value={search}
          onChange={(e) => { setSearch((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Types</option>
          <option value="FARMER">Farmer</option>
          <option value="TRADER">Trader</option>
          <option value="ARHTI">Arhti</option>
          <option value="BUYER">Buyer</option>
          <option value="OTHER">Other</option>
        </select>
        <select
          value={activeFilter}
          onChange={(e) => { setActiveFilter((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Credit Limit</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : parties.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No parties found</td></tr>
            ) : (
              parties.map((party) => (
                <tr
                  key={party.id}
                  onClick={() => router.push(`/parties/${party.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {party.name}
                    {party.name_urdu && (
                      <span className="block text-xs text-gray-400" dir="rtl">{party.name_urdu}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${PARTY_TYPE_COLORS[party.party_type] || ''}`}>
                      {party.party_type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{party.phone_primary}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {party.credit_limit_pkr ? `PKR ${party.credit_limit_pkr.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${party.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {party.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
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
