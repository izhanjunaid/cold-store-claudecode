'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface LoanSummary {
  id: string;
  loan_number: string;
  party_id: string;
  party_name?: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  RECOVERED: 'bg-gray-100 text-gray-700',
  WRITTEN_OFF: 'bg-red-100 text-red-700',
};

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  SECURITY: 1,
  OPERATOR: 2,
  ACCOUNTANT: 3,
  MANAGER: 4,
  OWNER: 5,
};

export default function LoansDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = (ROLE_RANK[user?.role ?? ''] ?? -1) >= ROLE_RANK['ACCOUNTANT']!;
  const isOwner = user?.role === 'OWNER';

  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const perPage = 20;

  const fetchLoans = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (statusFilter) params.set('status', statusFilter);
      const res = await apiClientList<LoanSummary>(`/v1/loans?${params}`);
      setLoans(res.data);
      setTotal(res.meta.total);
    } catch {
      // handled by apiClient
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, canAccess]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view loans.</p>
      </div>
    );
  }

  const totalOutstanding = loans
    .filter((l) => l.status === 'ACTIVE')
    .reduce((s, l) => s + Number(l.balance_outstanding_pkr), 0);

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Peshgi Loans</h1>
          <p className="text-sm text-gray-600">Informal cash advances to farmers and arhtis.</p>
        </div>
        {isOwner && (
          <Link
            href="/loans/issue"
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700"
          >
            Issue Peshgi
          </Link>
        )}
      </div>

      {/* Summary card */}
      <div className="bg-white rounded-xl shadow p-6 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-xs text-gray-500 uppercase">Total Active Loans</div>
            <div className="text-2xl font-bold text-gray-900">
              {loans.filter((l) => l.status === 'ACTIVE').length}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Outstanding (Active)</div>
            <div className="text-2xl font-bold text-emerald-700">
              PKR {totalOutstanding.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Recovered</div>
            <div className="text-2xl font-bold text-gray-700">
              {loans.filter((l) => l.status === 'RECOVERED').length}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Written Off</div>
            <div className="text-2xl font-bold text-red-700">
              {loans.filter((l) => l.status === 'WRITTEN_OFF').length}
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter((e.target as HTMLSelectElement).value);
            setPage(1);
          }}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="RECOVERED">Recovered</option>
          <option value="WRITTEN_OFF">Written Off</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Loan No.</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issued</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Principal</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading…</td></tr>
            ) : loans.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No loans found</td></tr>
            ) : (
              loans.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => router.push(`/loans/${l.id}`)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">{l.loan_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{l.party_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{l.issue_date}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{Number(l.principal_pkr).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{Number(l.balance_outstanding_pkr).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[l.status]}`}>
                      {l.status}
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
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
