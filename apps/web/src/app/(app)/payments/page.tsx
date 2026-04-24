'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface PaymentSummary {
  id: string;
  party_id: string;
  party_name: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  is_advance: boolean;
  status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' | 'DISHONOURED';
  clearance_status: string;
  created_at: string;
  allocations: { id: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  RECORDED: 'bg-blue-100 text-blue-800',
  ALLOCATED: 'bg-green-100 text-green-800',
  ADVANCE: 'bg-purple-100 text-purple-800',
  DISHONOURED: 'bg-red-100 text-red-800',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_WALLET: 'Mobile Wallet',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function PaymentListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [methodFilter, setMethodFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const canAccess = !user || (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const fetchPayments = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      if (methodFilter) params.set('payment_method', methodFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiClientList<PaymentSummary>(`/v1/payments?${params}`);
      setPayments(res.data);
      setTotal(res.meta.total);
    } catch {
      // handled by apiClient
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, methodFilter, dateFrom, dateTo, canAccess]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view payments.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <button
          onClick={() => router.push('/payments/new')}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          Record Payment
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="RECORDED">Recorded</option>
          <option value="ALLOCATED">Allocated</option>
          <option value="ADVANCE">Advance</option>
          <option value="DISHONOURED">Dishonoured</option>
        </select>
        <select
          value={methodFilter}
          onChange={(e) => { setMethodFilter((e.target as HTMLSelectElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Methods</option>
          <option value="CASH">Cash</option>
          <option value="CHEQUE">Cheque</option>
          <option value="BANK_TRANSFER">Bank Transfer</option>
          <option value="MOBILE_WALLET">Mobile Wallet</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo((e.target as HTMLInputElement).value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Allocations</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No payments found</td></tr>
            ) : (
              payments.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => router.push(`/payments/${p.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm text-gray-600">{p.payment_date}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{p.party_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">
                    {p.reference_number ?? <span className="text-gray-400 italic">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{p.amount_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">{p.allocations.length}</td>
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
