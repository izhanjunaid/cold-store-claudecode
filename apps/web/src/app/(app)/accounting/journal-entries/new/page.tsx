'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface Account {
  account_code: string;
  account_name: string;
  account_type: 'HEADER' | 'DETAIL';
  is_active: boolean;
}

interface Line {
  account_code: string;
  debit_amount: string;
  credit_amount: string;
  description: string;
}

const today = () => new Date().toISOString().slice(0, 10);

const emptyLine = (): Line => ({
  account_code: '',
  debit_amount: '',
  credit_amount: '',
  description: '',
});

export default function NewJournalEntryPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState('');
  const [bookType, setBookType] = useState<'PACCI' | 'KATCHI'>('PACCI');
  const [postingStatus, setPostingStatus] = useState<'AUTO_DRAFT' | 'POSTED'>('AUTO_DRAFT');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient<Account[]>('/v1/accounting/accounts?is_active=true').then(setAccounts);
  }, []);

  const detailAccounts = accounts.filter((a) => a.account_type === 'DETAIL' && a.is_active);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const updateLine = (idx: number, patch: Partial<Line>) => {
    setLines((current) => current.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => setLines((c) => [...c, emptyLine()]);
  const removeLine = (idx: number) => setLines((c) => (c.length > 2 ? c.filter((_, i) => i !== idx) : c));

  const submit = async () => {
    setError(null);
    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    if (!balanced) {
      setError('Debits and credits must balance to a positive total');
      return;
    }
    const payload = {
      entry_date: entryDate,
      description: description.trim(),
      book_type: bookType,
      posting_status: postingStatus,
      lines: lines.map((l) => ({
        account_code: l.account_code,
        debit_amount: parseFloat(l.debit_amount) || 0,
        credit_amount: parseFloat(l.credit_amount) || 0,
        description: l.description.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string }>('/v1/accounting/journal-entries', {
        method: 'POST',
        body: payload,
      });
      router.push(`/accounting/journal-entries/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isOwner = user?.role === 'OWNER';

  return (
    <div className="max-w-4xl">
      <button onClick={() => router.push('/accounting/journal-entries')} className="text-sm text-blue-600 hover:underline mb-4">
        ← Back
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Manual Journal Entry</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Entry Date</span>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate((e.target as HTMLInputElement).value)}
              className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Book Type</span>
            <select
              value={bookType}
              onChange={(e) => setBookType((e.target as HTMLSelectElement).value as 'PACCI' | 'KATCHI')}
              className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="PACCI">PACCI (Official)</option>
              {isOwner && <option value="KATCHI">KATCHI (Internal — OWNER only)</option>}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Status</span>
            <select
              value={postingStatus}
              onChange={(e) => setPostingStatus((e.target as HTMLSelectElement).value as 'AUTO_DRAFT' | 'POSTED')}
              className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="AUTO_DRAFT">Save as Draft</option>
              <option value="POSTED">Post immediately</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription((e.target as HTMLInputElement).value)}
            placeholder="e.g. Reclassify Q1 storage adjustment"
            className="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden mb-4">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-72">Account</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-32">Debit</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-32">Credit</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="px-3 py-2">
                  <select
                    value={l.account_code}
                    onChange={(e) => updateLine(idx, { account_code: (e.target as HTMLSelectElement).value })}
                    className="w-full border rounded px-2 py-1 text-sm font-mono"
                  >
                    <option value="">Select account...</option>
                    {detailAccounts.map((a) => (
                      <option key={a.account_code} value={a.account_code}>
                        {a.account_code} — {a.account_name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={l.description}
                    onChange={(e) => updateLine(idx, { description: (e.target as HTMLInputElement).value })}
                    placeholder="Optional"
                    className="w-full border rounded px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.debit_amount}
                    onChange={(e) => updateLine(idx, { debit_amount: (e.target as HTMLInputElement).value, credit_amount: '' })}
                    className="w-full border rounded px-2 py-1 text-sm text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={l.credit_amount}
                    onChange={(e) => updateLine(idx, { credit_amount: (e.target as HTMLInputElement).value, debit_amount: '' })}
                    className="w-full border rounded px-2 py-1 text-sm text-right"
                  />
                </td>
                <td className="px-3 py-2">
                  {lines.length > 2 && (
                    <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700">×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td className="px-3 py-2 text-right text-sm" colSpan={2}>
                <button onClick={addLine} className="text-blue-600 hover:underline text-sm">+ Add line</button>
              </td>
              <td className="px-3 py-2 text-sm text-right font-semibold">{totalDebit.toLocaleString()}</td>
              <td className="px-3 py-2 text-sm text-right font-semibold">{totalCredit.toLocaleString()}</td>
              <td></td>
            </tr>
            <tr className={balanced ? 'text-green-700' : 'text-red-700'}>
              <td colSpan={5} className="px-3 py-2 text-sm text-right">
                {balanced ? `✓ Balanced (Rs. ${totalDebit.toLocaleString()})` : `✗ Unbalanced — diff Rs. ${Math.abs(totalDebit - totalCredit).toLocaleString()}`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={submit}
          disabled={submitting || !balanced}
          className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Saving...' : postingStatus === 'POSTED' ? 'Post Entry' : 'Save Draft'}
        </button>
        <button onClick={() => router.push('/accounting/journal-entries')} className="text-sm text-gray-600 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
