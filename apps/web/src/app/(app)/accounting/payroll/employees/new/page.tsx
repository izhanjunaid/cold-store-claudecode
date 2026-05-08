'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function NewEmployeePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3;

  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [cnic, setCnic] = useState('');
  const [type, setType] = useState<'SALARIED' | 'DAILY_WAGE'>('SALARIED');
  const [designation, setDesignation] = useState('');
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [salary, setSalary] = useState('');
  const [wage, setWage] = useState('');
  const [eobiRegistered, setEobiRegistered] = useState(true);
  const [bankAcct, setBankAcct] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Need MANAGER+ role.</p></div>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name,
        name_urdu: nameUrdu || null,
        cnic: cnic || null,
        employee_type: type,
        designation: designation || null,
        join_date: joinDate,
        eobi_registered: eobiRegistered,
        bank_account_number: bankAcct || null,
        bank_name: bankName || null,
      };
      if (type === 'SALARIED') payload['basic_salary_pkr'] = Number(salary);
      else payload['daily_wage_pkr'] = Number(wage);

      const created = await apiClient<{ id: string }>('/v1/employees', { method: 'POST', body: payload });
      router.push(`/accounting/payroll/employees/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Employee</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name (Urdu)</label>
            <input type="text" dir="rtl" value={nameUrdu} onChange={(e) => setNameUrdu(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CNIC</label>
            <input type="text" value={cnic} onChange={(e) => setCnic(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="42101-1234567-8" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
            <select value={type} onChange={(e) => setType(e.target.value as any)} className="w-full border rounded-lg px-3 py-2">
              <option value="SALARIED">Salaried (monthly)</option>
              <option value="DAILY_WAGE">Daily Wage</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
            <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="Manager, Loader, etc." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Join Date *</label>
            <input type="date" required value={joinDate} onChange={(e) => setJoinDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        {type === 'SALARIED' ? (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Basic Salary (PKR/month) *</label>
            <input type="number" required min="0" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Wage (PKR/day) *</label>
            <input type="number" required min="0" step="0.01" value={wage} onChange={(e) => setWage(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        )}

        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={eobiRegistered} onChange={(e) => setEobiRegistered(e.target.checked)} />
            <span className="text-sm font-medium text-gray-700">EOBI registered (Rs. 375 employee + Rs. 1,875 employer per month)</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account Number</label>
            <input type="text" value={bankAcct} onChange={(e) => setBankAcct(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
            <input type="text" value={bankName} onChange={(e) => setBankName(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Creating...' : 'Create Employee'}</button>
          <button type="button" onClick={() => router.back()} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
        </div>
      </form>
    </div>
  );
}
