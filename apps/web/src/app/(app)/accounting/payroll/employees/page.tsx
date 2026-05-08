'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface Employee {
  id: string;
  name: string;
  cnic: string | null;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  designation: string | null;
  basic_salary_pkr: number | null;
  daily_wage_pkr: number | null;
  eobi_registered: boolean;
  is_active: boolean;
}

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function EmployeeListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3;

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('true');
  const [loading, setLoading] = useState(true);
  const perPage = 50;

  const fetchEmployees = useCallback(async () => {
    if (!canAccess) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(perPage) });
      if (typeFilter) params.set('employee_type', typeFilter);
      if (activeFilter) params.set('is_active', activeFilter);
      const res = await apiClientList<Employee>(`/v1/employees?${params}`);
      setEmployees(res.data);
      setTotal(res.meta.total);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, activeFilter, canAccess]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  if (!canAccess) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">No permission.</p></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        {canCreate && (
          <Link href="/accounting/payroll/employees/new" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            + New Employee
          </Link>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4">
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          <option value="SALARIED">Salaried</option>
          <option value="DAILY_WAGE">Daily Wage</option>
        </select>
        <select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }} className="border rounded-lg px-3 py-2 text-sm">
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
          <option value="">All</option>
        </select>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Designation</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">CNIC</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Pay (PKR)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">EOBI</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-500">No employees</td></tr>
            ) : (
              employees.map((e) => {
                const pay = e.employee_type === 'SALARIED' ? e.basic_salary_pkr : e.daily_wage_pkr;
                return (
                  <tr key={e.id} onClick={() => router.push(`/accounting/payroll/employees/${e.id}`)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{e.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{e.designation ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{e.employee_type === 'SALARIED' ? 'Salaried' : 'Daily Wage'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{e.cnic ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-right">{pay ? `${pay.toLocaleString()}${e.employee_type === 'DAILY_WAGE' ? '/day' : '/mo'}` : '—'}</td>
                    <td className="px-4 py-3 text-sm">{e.eobi_registered ? <span className="text-green-700">✓</span> : <span className="text-gray-400">—</span>}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-medium rounded-full ${e.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>{e.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-2 text-xs text-gray-500">{total} employee(s)</div>
    </div>
  );
}
