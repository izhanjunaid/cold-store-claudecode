'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function NewPayrollRunPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const now = new Date();
  const [type, setType] = useState<'MONTHLY_SALARY' | 'DAILY_WAGES'>('MONTHLY_SALARY');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Need ACCOUNTANT+.</p></div>;
  }

  function lastDayOfMonth(y: number, m: number) {
    return new Date(y, m, 0).getDate();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const periodFrom = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
      const created = await apiClient<{ id: string }>('/v1/payroll-runs', {
        method: 'POST',
        body: {
          payroll_type: type,
          period_year: year,
          period_month: month,
          period_from: periodFrom,
          period_to: periodTo,
        },
      });
      router.push(`/accounting/payroll/runs/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Payroll Run</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <p className="text-sm text-gray-600">A DRAFT run snapshots all active employees of the selected type at current pay rates with EOBI auto-calculated for registered employees (Rs. 375 employee + Rs. 1,875 employer). You can edit each line before finalizing.</p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payroll Type *</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="w-full border rounded-lg px-3 py-2">
            <option value="MONTHLY_SALARY">Monthly Salary (DR 6010, JE-15)</option>
            <option value="DAILY_WAGES">Daily Wages (DR 5030, JE-15B — direct cost)</option>
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year *</label>
            <input type="number" required min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m} — {new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create Draft'}
          </button>
          <button type="button" onClick={() => router.back()} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
        </div>
      </form>
    </div>
  );
}
