'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface PayrollRun {
  id: string;
  run_number: string;
  payroll_type: 'MONTHLY_SALARY' | 'DAILY_WAGES';
  period_year: number;
  period_month: number;
  total_gross_pkr: number;
  total_net_payable_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  finalized_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  FINALIZED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function PayrollRunsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const fetchRuns = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('payroll_type', typeFilter);
      const res = await apiClientList<PayrollRun>(`/v1/payroll-runs?${params}`);
      setRuns(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, canAccess]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  if (!canAccess) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">No permission.</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payroll Runs</h1>
        <Link href="/accounting/payroll/runs/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">+ New Run</Link>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          <option value="DRAFT">Draft</option>
          <option value="FINALIZED">Finalized</option>
          <option value="PAID">Paid</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="MONTHLY_SALARY">Monthly Salary</option>
          <option value="DAILY_WAGES">Daily Wages</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Run #</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross (PKR)</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net Payable (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : runs.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No payroll runs yet</td></tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id} onClick={() => router.push(`/accounting/payroll/runs/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-mono font-medium">{r.run_number}</td>
                  <td className="px-4 py-3 text-sm">{r.period_year}-{String(r.period_month).padStart(2, '0')}</td>
                  <td className="px-4 py-3 text-sm">{r.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'}</td>
                  <td className="px-4 py-3 text-sm text-right">{r.total_gross_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{r.total_net_payable_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-gray-500">{total} run(s)</div>
    </div>
  );
}
