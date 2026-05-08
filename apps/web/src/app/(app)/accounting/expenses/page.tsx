'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface ExpenseVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  amount_pkr: number;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
  is_accrual: boolean;
  payment_date: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  ACCRUED: 'bg-purple-100 text-purple-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function ExpenseVouchersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const [vouchers, setVouchers] = useState<ExpenseVoucher[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const fetchVouchers = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      const res = await apiClientList<ExpenseVoucher>(`/v1/expense-vouchers?${params}`);
      setVouchers(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, dateFrom, dateTo, canAccess]);

  useEffect(() => { fetchVouchers(); }, [fetchVouchers]);

  if (!canAccess) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">No permission.</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Expense Vouchers</h1>
        <Link href="/accounting/expenses/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ New Voucher</Link>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="APPROVED">Approved</option>
          <option value="ACCRUED">Accrued</option>
          <option value="PAID">Paid</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm" />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Voucher #</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : vouchers.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No vouchers yet</td></tr>
            ) : (
              vouchers.map((v) => (
                <tr key={v.id} onClick={() => router.push(`/accounting/expenses/${v.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-mono font-medium">{v.voucher_number}</td>
                  <td className="px-4 py-3 text-sm">{v.voucher_date}</td>
                  <td className="px-4 py-3 text-sm font-mono">{v.expense_account_code}</td>
                  <td className="px-4 py-3 text-sm">{v.description}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{v.vendor_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{v.amount_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[v.status]}`}>{v.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-gray-500">{total} voucher(s)</div>
    </div>
  );
}
