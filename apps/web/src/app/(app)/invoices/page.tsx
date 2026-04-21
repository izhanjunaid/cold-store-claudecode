'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  billing_party_name: string;
  lot_number: string;
  invoice_date: string;
  total_pkr: number;
  amount_paid_pkr: number;
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  FINALIZED: 'bg-green-100 text-green-800',
  VOID: 'bg-gray-100 text-gray-800',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function InvoiceListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [partySearch, setPartySearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const canAccess = !user || (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2; // ACCOUNTANT

  const fetchInvoices = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiClientList<InvoiceSummary>(`/v1/invoices?${params}`);
      setInvoices(res.data);
      setTotal(res.meta.total);
    } catch {
      // handled by apiClient
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, canAccess]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view invoices.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / perPage);

  const filtered = partySearch
    ? invoices.filter((i) => i.billing_party_name.toLowerCase().includes(partySearch.toLowerCase()))
    : invoices;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <input
          type="text"
          placeholder="Filter by party name..."
          value={partySearch}
          onChange={(e) => setPartySearch((e.target as HTMLInputElement).value)}
          className="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="FINALIZED">Finalized</option>
          <option value="VOID">Void</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
          placeholder="To"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Billing Party</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total (PKR)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid (PKR)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">No invoices found</td></tr>
            ) : (
              filtered.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-mono font-medium text-gray-900">
                    {inv.invoice_number ?? <span className="text-gray-400 italic">Draft</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900">{inv.billing_party_name}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">{inv.lot_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{inv.invoice_date}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{inv.total_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right text-green-700">{inv.amount_paid_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-red-700">{inv.balance_due_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[inv.status]}`}>
                      {inv.status}
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
