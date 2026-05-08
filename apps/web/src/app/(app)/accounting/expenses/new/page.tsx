'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

// Common 5XXX/6XXX expense accounts (subset for selector)
const EXPENSE_ACCOUNTS = [
  { code: '5010', name: 'Electricity — Refrigeration' },
  { code: '5020', name: 'Electricity — Facility (Non-Refrig.)' },
  { code: '5050', name: 'Refrigerant & Consumables' },
  { code: '5060', name: 'Packaging & Materials' },
  { code: '6020', name: 'Rent' },
  { code: '6030', name: 'Maintenance & Repairs' },
  { code: '6040', name: 'Fuel & Vehicle' },
  { code: '6050', name: 'Insurance' },
  { code: '6060', name: 'Communication' },
  { code: '6070', name: 'Computer & Software' },
  { code: '6090', name: 'Bank Charges' },
  { code: '6100', name: 'Miscellaneous' },
];

export default function NewExpenseVoucherPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountCode, setAccountCode] = useState('5010');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [isAccrual, setIsAccrual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Need ACCOUNTANT+.</p></div>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient<{ id: string }>('/v1/expense-vouchers', {
        method: 'POST',
        body: {
          voucher_date: voucherDate,
          expense_account_code: accountCode,
          description,
          vendor_name: vendor || null,
          reference_number: refNumber || null,
          amount_pkr: Number(amount),
          is_accrual: isAccrual,
        },
      });
      router.push(`/accounting/expenses/${created.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Expense Voucher</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <p className="text-sm text-gray-600">Voucher starts as DRAFT. After creation: Approve (MANAGER+) → Pay (JE-17A) or Accrue (JE-17B) then Pay (JE-17B-PAY).</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Voucher Date *</label>
            <input type="date" required value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expense Account *</label>
            <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className="w-full border rounded-lg px-3 py-2">
              {EXPENSE_ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
          <input type="text" required value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., LESCO refrigeration bill — April 2026" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
            <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g., LESCO" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reference / Bill #</label>
            <input type="text" value={refNumber} onChange={(e) => setRefNumber(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
          <input type="number" required min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
        </div>

        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isAccrual} onChange={(e) => setIsAccrual(e.target.checked)} />
            <span className="text-sm font-medium text-gray-700">This is an accrual (bill received, payment scheduled later)</span>
          </label>
          <p className="text-xs text-gray-500 mt-1 ml-6">If checked, after approval you accrue (JE-17B: DR 5XXX/6XXX, CR 2040), then pay later (JE-17B-PAY: DR 2040, CR 1010/1020).</p>
        </div>

        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">{submitting ? 'Creating...' : 'Create Draft'}</button>
          <button type="button" onClick={() => router.back()} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
        </div>
      </form>
    </div>
  );
}
