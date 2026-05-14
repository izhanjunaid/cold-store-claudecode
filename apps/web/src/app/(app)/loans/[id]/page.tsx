'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface Repayment {
  id: string;
  repayment_date: string;
  amount_pkr: number;
  payment_method: 'CASH' | 'BANK_TRANSFER' | 'DEDUCTED_FROM_PRODUCE';
  asset_account_code: string | null;
  payment_id: string | null;
  journal_entry_id: string | null;
  notes: string | null;
}

interface Loan {
  id: string;
  loan_number: string;
  party_id: string;
  party_name?: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
  book_type: string;
  source_asset_account_code: string;
  issue_journal_entry_id: string | null;
  write_off_journal_entry_id: string | null;
  write_off_reason: string | null;
  write_off_at: string | null;
  notes: string | null;
  created_at: string;
  repayments?: Repayment[];
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

export default function LoanDetailPage() {
  const router = useRouter();
  const params = useParams();
  const loanId = params['id'] as string;
  const { user } = useAuthStore();

  const isOwner = user?.role === 'OWNER';
  const canRepay = (ROLE_RANK[user?.role ?? ''] ?? -1) >= ROLE_RANK['MANAGER']!;
  const canView = (ROLE_RANK[user?.role ?? ''] ?? -1) >= ROLE_RANK['ACCOUNTANT']!;

  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [repayModal, setRepayModal] = useState(false);
  const [repayDate, setRepayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [repayLoading, setRepayLoading] = useState(false);
  const [repayErr, setRepayErr] = useState<string | null>(null);

  const [writeOffModal, setWriteOffModal] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffLoading, setWriteOffLoading] = useState(false);
  const [writeOffErr, setWriteOffErr] = useState<string | null>(null);

  const fetchLoan = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<Loan>(`/v1/loans/${loanId}`);
      setLoan(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan');
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    fetchLoan();
  }, [fetchLoan]);

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">You don&apos;t have permission to view this loan.</p>
      </div>
    );
  }
  if (loading) return <div className="text-gray-500 p-6">Loading…</div>;
  if (error) return <div className="text-red-600 p-6">{error}</div>;
  if (!loan) return <div className="text-gray-500 p-6">Loan not found</div>;

  async function submitRepayment() {
    setRepayLoading(true);
    setRepayErr(null);
    try {
      const amt = Number(repayAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid amount');
      const assetCode = repayMethod === 'CASH' ? '1010' : '1020';
      await apiClient(`/v1/loans/${loanId}/repayments`, {
        method: 'POST',
        body: {
          repayment_date: repayDate,
          amount_pkr: amt,
          payment_method: repayMethod,
          asset_account_code: assetCode,
        },
      });
      setRepayModal(false);
      setRepayAmount('');
      await fetchLoan();
    } catch (err) {
      setRepayErr(err instanceof Error ? err.message : 'Repayment failed');
    } finally {
      setRepayLoading(false);
    }
  }

  async function submitWriteOff() {
    setWriteOffLoading(true);
    setWriteOffErr(null);
    try {
      if (writeOffReason.trim().length < 3) throw new Error('Reason must be at least 3 characters');
      await apiClient(`/v1/loans/${loanId}/write-off`, {
        method: 'POST',
        body: { reason: writeOffReason.trim() },
      });
      setWriteOffModal(false);
      setWriteOffReason('');
      await fetchLoan();
    } catch (err) {
      setWriteOffErr(err instanceof Error ? err.message : 'Write-off failed');
    } finally {
      setWriteOffLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{loan.loan_number}</h1>
          <p className="text-sm text-gray-600">
            {loan.party_name ?? '—'} • Issued {loan.issue_date}
          </p>
        </div>
        <div className="flex gap-2">
          {loan.status === 'ACTIVE' && canRepay && (
            <button
              onClick={() => setRepayModal(true)}
              className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Record Repayment
            </button>
          )}
          {loan.status === 'ACTIVE' && isOwner && (
            <button
              onClick={() => setWriteOffModal(true)}
              className="border border-red-300 text-red-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-50"
            >
              Write Off
            </button>
          )}
        </div>
      </div>

      {/* Header card */}
      <div className="bg-white rounded-xl shadow p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <div className="text-xs text-gray-500 uppercase">Status</div>
            <span className={`inline-block mt-1 px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[loan.status]}`}>
              {loan.status}
            </span>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Principal</div>
            <div className="text-xl font-bold text-gray-900">PKR {Number(loan.principal_pkr).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Balance Outstanding</div>
            <div className={`text-xl font-bold ${loan.balance_outstanding_pkr > 0 ? 'text-emerald-700' : 'text-gray-700'}`}>
              PKR {Number(loan.balance_outstanding_pkr).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Source Account</div>
            <div className="text-base font-mono text-gray-700">{loan.source_asset_account_code}</div>
          </div>
        </div>
        {loan.status === 'WRITTEN_OFF' && loan.write_off_reason && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-900">
            <strong>Write-off reason:</strong> {loan.write_off_reason}
            {loan.write_off_at && (
              <span className="ml-2 text-red-700">on {new Date(loan.write_off_at).toLocaleDateString()}</span>
            )}
          </div>
        )}
      </div>

      {/* Repayment timeline */}
      <div className="bg-white rounded-xl shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Repayment History</h2>
        {loan.repayments && loan.repayments.length > 0 ? (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">JE</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loan.repayments.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 text-sm text-gray-700">{r.repayment_date}</td>
                  <td className="px-4 py-2 text-sm text-right font-medium">{Number(r.amount_pkr).toLocaleString()}</td>
                  <td className="px-4 py-2 text-sm text-gray-700">{r.payment_method.replace('_', ' ')}</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-600">{r.asset_account_code ?? '—'}</td>
                  <td className="px-4 py-2 text-xs font-mono text-gray-500">
                    {r.journal_entry_id ? r.journal_entry_id.slice(0, 8) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-500">No repayments recorded.</p>
        )}
      </div>

      {/* Issue JE link */}
      <div className="bg-white rounded-xl shadow p-6 text-sm text-gray-600">
        <strong className="text-gray-900">Issue JE:</strong>{' '}
        <span className="font-mono">{loan.issue_journal_entry_id ?? '—'}</span>
        {loan.write_off_journal_entry_id && (
          <>
            <span className="mx-2">•</span>
            <strong className="text-gray-900">Write-Off JE:</strong>{' '}
            <span className="font-mono">{loan.write_off_journal_entry_id}</span>
          </>
        )}
        <button
          onClick={() => router.push(`/loans`)}
          className="ml-4 text-blue-600 hover:underline"
        >
          ← Back to Loans
        </button>
      </div>

      {/* Repayment modal */}
      {repayModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-900">Record Repayment</h3>
            {repayErr && <div className="bg-red-50 text-red-800 p-2 rounded text-sm">{repayErr}</div>}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Date</span>
              <input
                type="date"
                value={repayDate}
                onChange={(e) => setRepayDate((e.target as HTMLInputElement).value)}
                className="mt-1 w-full h-10 px-3 border border-gray-300 rounded-lg"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Amount (PKR)</span>
              <input
                type="number"
                step="0.01"
                value={repayAmount}
                onChange={(e) => setRepayAmount((e.target as HTMLInputElement).value)}
                className="mt-1 w-full h-10 px-3 border border-gray-300 rounded-lg"
              />
              <span className="text-xs text-gray-500">Outstanding: PKR {Number(loan.balance_outstanding_pkr).toLocaleString()}</span>
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-gray-700">Method</legend>
              <div className="mt-2 inline-flex rounded-lg border overflow-hidden">
                {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRepayMethod(m)}
                    className={`px-3 py-1.5 text-sm ${repayMethod === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
                  >
                    {m === 'CASH' ? 'Cash' : 'Bank'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setRepayModal(false)} className="px-4 py-2 text-sm hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={submitRepayment}
                disabled={repayLoading}
                className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {repayLoading ? 'Saving…' : 'Record Repayment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Write-off modal */}
      {writeOffModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-red-700">Write Off Loan</h3>
            <p className="text-sm text-gray-600">
              This will post JE-20 (DR 6080 Bad Debt / CR 1140 Peshgi AR) for the outstanding balance and mark the loan WRITTEN_OFF. This action cannot be undone.
            </p>
            {writeOffErr && <div className="bg-red-50 text-red-800 p-2 rounded text-sm">{writeOffErr}</div>}
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Reason *</span>
              <textarea
                value={writeOffReason}
                onChange={(e) => setWriteOffReason((e.target as HTMLTextAreaElement).value)}
                rows={3}
                placeholder="Bad debt — farmer relocated, unable to recover"
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setWriteOffModal(false)} className="px-4 py-2 text-sm hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={submitWriteOff}
                disabled={writeOffLoading}
                className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {writeOffLoading ? 'Writing off…' : 'Write Off'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
