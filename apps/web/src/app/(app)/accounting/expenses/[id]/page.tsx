'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

interface ExpenseVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  payment_date: string | null;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  reference_number: string | null;
  amount_pkr: number;
  payment_method: string | null;
  asset_account_code: string | null;
  is_accrual: boolean;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
  accrual_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  ACCRUED: 'bg-purple-100 text-purple-800',
  PAID: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-800',
};

export default function ExpenseVoucherDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isManager = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3;
  const isAccountant = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  const [v, setV] = useState<ExpenseVoucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPay, setShowPay] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CHEQUE' | 'BANK_TRANSFER'>('BANK_TRANSFER');
  const [assetAccount, setAssetAccount] = useState('1020');

  const fetchV = useCallback(async () => {
    setLoading(true);
    try { setV(await apiClient<ExpenseVoucher>(`/v1/expense-vouchers/${id}`)); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchV(); }, [fetchV]);

  async function action(path: string, body?: unknown) {
    setActionError(null);
    try {
      await apiClient(`/v1/expense-vouchers/${id}/${path}`, { method: 'POST', body: body ?? {} });
      fetchV();
      return true;
    } catch (e: any) {
      setActionError(e.message);
      return false;
    }
  }

  async function pay() {
    const ok = await action('pay', {
      payment_date: paymentDate,
      payment_method: paymentMethod,
      asset_account_code: assetAccount,
    });
    if (ok) setShowPay(false);
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!v) return <div className="p-8 text-red-700">Voucher not found</div>;

  return (
    <div>
      <button onClick={() => router.push('/accounting/expenses')} className="text-sm text-blue-600 hover:underline mb-4">← Back to vouchers</button>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-sm text-gray-500">{v.voucher_number}</div>
            <h1 className="text-2xl font-bold text-gray-900">{v.description}</h1>
            <div className="text-sm text-gray-600 mt-1">
              {v.voucher_date} · Account <span className="font-mono">{v.expense_account_code}</span>
              {v.vendor_name && ` · ${v.vendor_name}`}
              {v.reference_number && ` · Ref ${v.reference_number}`}
            </div>
          </div>
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${STATUS_COLORS[v.status]}`}>{v.status}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-6">
          <div><div className="text-xs text-gray-500 uppercase">Amount</div><div className="text-lg font-semibold">Rs. {v.amount_pkr.toLocaleString()}</div></div>
          {v.payment_date && <div><div className="text-xs text-gray-500 uppercase">Paid On</div><div className="text-base">{v.payment_date} ({v.payment_method})</div></div>}
          <div><div className="text-xs text-gray-500 uppercase">Type</div><div className="text-base">{v.is_accrual ? 'Accrual' : 'Direct'}</div></div>
        </div>

        <div className="mt-4 text-sm text-gray-600 space-y-1">
          {v.accrual_journal_entry_id && <div>Accrual JE-17B: <button onClick={() => router.push(`/accounting/journal-entries/${v.accrual_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{v.accrual_journal_entry_id.slice(0, 8)}…</button></div>}
          {v.payment_journal_entry_id && <div>Payment JE: <button onClick={() => router.push(`/accounting/journal-entries/${v.payment_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{v.payment_journal_entry_id.slice(0, 8)}…</button></div>}
        </div>

        {actionError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mt-4">{actionError}</div>}

        <div className="mt-6 flex gap-2 flex-wrap">
          {isManager && v.status === 'DRAFT' && (
            <button onClick={() => action('approve')} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">Approve</button>
          )}
          {isAccountant && v.status === 'APPROVED' && v.is_accrual && (
            <button onClick={() => action('accrue')} className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700">Accrue (JE-17B)</button>
          )}
          {isAccountant && (v.status === 'APPROVED' || v.status === 'ACCRUED') && (
            <button onClick={() => setShowPay(true)} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">
              Pay ({v.status === 'ACCRUED' ? 'JE-17B-PAY' : 'JE-17A'})
            </button>
          )}
          {isManager && (v.status === 'DRAFT' || v.status === 'APPROVED') && (
            <button onClick={() => action('cancel', { reason: 'Cancelled from UI' })} className="border border-red-300 text-red-700 px-4 py-2 rounded-lg hover:bg-red-50">Cancel</button>
          )}
        </div>
      </div>

      {showPay && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Pay Expense Voucher</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <select value={paymentMethod} onChange={(e) => {
                  const m = e.target.value as any;
                  setPaymentMethod(m);
                  if (m === 'CASH') setAssetAccount('1010');
                  else setAssetAccount('1020');
                }} className="w-full border rounded-lg px-3 py-2">
                  <option value="CASH">Cash (1010)</option>
                  <option value="CHEQUE">Cheque (1020)</option>
                  <option value="BANK_TRANSFER">Bank Transfer (1020)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Asset Account</label>
                <select value={assetAccount} onChange={(e) => setAssetAccount(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  <option value="1010">1010 — Cash on Hand</option>
                  <option value="1020">1020 — Bank Account — Main</option>
                </select>
              </div>
            </div>
            {actionError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mt-3">{actionError}</div>}
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowPay(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={pay} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Pay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
