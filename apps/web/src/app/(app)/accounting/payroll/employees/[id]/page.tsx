'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

interface Employee {
  id: string;
  name: string;
  name_urdu: string | null;
  cnic: string | null;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  designation: string | null;
  join_date: string;
  basic_salary_pkr: number | null;
  daily_wage_pkr: number | null;
  eobi_registered: boolean;
  bank_account_number: string | null;
  bank_name: string | null;
  is_active: boolean;
  termination_date: string | null;
  notes: string | null;
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isOwner = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;
  const canEdit = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3;

  const [emp, setEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTerminate, setShowTerminate] = useState(false);
  const [terminationDate, setTerminationDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const fetchEmp = useCallback(async () => {
    setLoading(true);
    try {
      setEmp(await apiClient<Employee>(`/v1/employees/${id}`));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchEmp(); }, [fetchEmp]);

  async function terminate() {
    setError(null);
    try {
      await apiClient(`/v1/employees/${id}/terminate`, { method: 'POST', body: { termination_date: terminationDate } });
      setShowTerminate(false);
      fetchEmp();
    } catch (e: any) { setError(e.message); }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!emp) return <div className="p-8 text-red-700">Employee not found</div>;

  return (
    <div>
      <button onClick={() => router.push('/accounting/payroll/employees')} className="text-sm text-blue-600 hover:underline mb-4">← Back to employees</button>

      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{emp.name}</h1>
            {emp.name_urdu && <div className="text-lg" dir="rtl">{emp.name_urdu}</div>}
            <div className="text-sm text-gray-600 mt-1">
              {emp.designation ?? 'No designation'} · {emp.employee_type === 'SALARIED' ? 'Salaried' : 'Daily Wage'} · Joined {emp.join_date}
            </div>
          </div>
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${emp.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
            {emp.is_active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div>
            <div className="text-xs text-gray-500 uppercase">Pay</div>
            <div className="text-lg font-semibold">
              Rs. {emp.employee_type === 'SALARIED' ? emp.basic_salary_pkr?.toLocaleString() : `${emp.daily_wage_pkr?.toLocaleString()}/day`}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">CNIC</div>
            <div className="text-base font-mono">{emp.cnic ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">EOBI</div>
            <div className="text-base">{emp.eobi_registered ? '✓ Registered' : '—'}</div>
          </div>
          {emp.bank_account_number && (
            <div className="col-span-2">
              <div className="text-xs text-gray-500 uppercase">Bank</div>
              <div className="text-base">{emp.bank_name ?? ''} · {emp.bank_account_number}</div>
            </div>
          )}
          {emp.termination_date && (
            <div>
              <div className="text-xs text-gray-500 uppercase">Terminated</div>
              <div className="text-base text-red-700">{emp.termination_date}</div>
            </div>
          )}
        </div>

        {emp.notes && (
          <div className="mt-4">
            <div className="text-xs text-gray-500 uppercase mb-1">Notes</div>
            <div className="text-sm text-gray-700">{emp.notes}</div>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          {canEdit && emp.is_active && (
            <button onClick={() => router.push(`/accounting/payroll/employees/${id}/edit`)} className="border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50" disabled>
              Edit (todo)
            </button>
          )}
          {isOwner && emp.is_active && (
            <button onClick={() => setShowTerminate(true)} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">Terminate</button>
          )}
        </div>
      </div>

      {showTerminate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Terminate Employee</h3>
            <label className="block text-sm font-medium text-gray-700 mb-1">Termination Date</label>
            <input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-4" />
            {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mb-3">{error}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowTerminate(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={terminate} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">Terminate</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
