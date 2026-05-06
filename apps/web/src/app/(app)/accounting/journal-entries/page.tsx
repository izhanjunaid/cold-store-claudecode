'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  book_type: 'PACCI' | 'KATCHI';
  source_table: string;
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  total_debit_pkr: number;
  total_credit_pkr: number;
}

const STATUS_COLORS: Record<string, string> = {
  POSTED: 'bg-green-100 text-green-800',
  AUTO_DRAFT: 'bg-yellow-100 text-yellow-800',
  REVERSED: 'bg-red-100 text-red-800',
};

const TYPE_COLORS: Record<string, string> = {
  INVOICE: 'bg-blue-100 text-blue-800',
  PAYMENT: 'bg-emerald-100 text-emerald-800',
  ADVANCE: 'bg-purple-100 text-purple-800',
  ADVANCE_APPLIED: 'bg-purple-100 text-purple-800',
  CREDIT_NOTE: 'bg-orange-100 text-orange-800',
  REVERSAL: 'bg-red-100 text-red-800',
  BAD_DEBT: 'bg-red-100 text-red-800',
  ADJUSTMENT: 'bg-gray-100 text-gray-800',
};

export default function JournalEntryListPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 25;

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (typeFilter) params.set('entry_type', typeFilter);
      if (bookFilter) params.set('book_type', bookFilter);
      if (statusFilter) params.set('posting_status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiClientList<JournalEntry>(`/v1/accounting/journal-entries?${params}`);
      setEntries(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, bookFilter, statusFilter, dateFrom, dateTo]);

  useEffect(() => { fetch(); }, [fetch]);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Journal Entries</h1>
        <button
          onClick={() => router.push('/accounting/journal-entries/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          New Manual Entry
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-3 flex-wrap">
        <select value={typeFilter} onChange={(e) => { setTypeFilter((e.target as HTMLSelectElement).value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="INVOICE">Invoice</option>
          <option value="PAYMENT">Payment</option>
          <option value="ADVANCE">Advance</option>
          <option value="ADVANCE_APPLIED">Advance Applied</option>
          <option value="CREDIT_NOTE">Credit Note</option>
          <option value="REVERSAL">Reversal</option>
          <option value="BAD_DEBT">Bad Debt</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </select>
        <select value={bookFilter} onChange={(e) => { setBookFilter((e.target as HTMLSelectElement).value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">PACCI + KATCHI</option>
          <option value="PACCI">PACCI only</option>
          <option value="KATCHI">KATCHI only</option>
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="POSTED">Posted</option>
          <option value="AUTO_DRAFT">Draft</option>
          <option value="REVERSED">Reversed</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom((e.target as HTMLInputElement).value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo((e.target as HTMLInputElement).value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Number</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Book</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No journal entries yet</td></tr>
            ) : (
              entries.map((e) => (
                <tr
                  key={e.id}
                  onClick={() => router.push(`/accounting/journal-entries/${e.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">{e.entry_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{e.entry_date}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${TYPE_COLORS[e.entry_type] ?? 'bg-gray-100 text-gray-800'}`}>
                      {e.entry_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.book_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 max-w-md truncate">{e.description}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{e.total_debit_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[e.posting_status]}`}>
                      {e.posting_status}
                    </span>
                  </td>
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
