'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface JournalEntryLine {
  id: string;
  line_number: number;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  party_id: string | null;
  party_name: string | null;
  lot_id: string | null;
  lot_number: string | null;
  description: string | null;
}

interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  book_type: 'PACCI' | 'KATCHI';
  source_table: string;
  source_id: string;
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  reversed_by_entry_number: string | null;
  total_debit_pkr: number;
  total_credit_pkr: number;
  created_at: string;
  created_by_name: string;
  lines: JournalEntryLine[];
}

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<JournalEntry>(`/v1/accounting/journal-entries/${params.id}`)
      .then(setEntry)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="text-gray-500">Loading...</div>;
  if (!entry) return <div className="text-gray-500">Entry not found</div>;

  const balanced = Math.abs(entry.total_debit_pkr - entry.total_credit_pkr) < 0.01;

  return (
    <div>
      <button
        onClick={() => router.push('/accounting/journal-entries')}
        className="text-sm text-blue-600 hover:underline mb-4"
      >
        ← Back to Journal Entries
      </button>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{entry.entry_number}</h1>
            <p className="text-sm text-gray-600 mt-1">{entry.description}</p>
          </div>
          <div className="text-right">
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${entry.posting_status === 'POSTED' ? 'bg-green-100 text-green-800' : entry.posting_status === 'REVERSED' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
              {entry.posting_status}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 text-sm">
          <div>
            <dt className="text-gray-500">Entry Date</dt>
            <dd className="font-medium">{entry.entry_date}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Type</dt>
            <dd className="font-medium">{entry.entry_type}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Book</dt>
            <dd className="font-medium">{entry.book_type}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Source</dt>
            <dd className="font-mono text-xs">{entry.source_table}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created</dt>
            <dd className="font-medium">{new Date(entry.created_at).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Created By</dt>
            <dd className="font-medium">{entry.created_by_name}</dd>
          </div>
          {entry.reversed_by_entry_number && (
            <div>
              <dt className="text-gray-500">Reversed By</dt>
              <dd className="font-mono text-xs">{entry.reversed_by_entry_number}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Lines</h2>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">#</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lot</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {entry.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 text-xs text-gray-500">{l.line_number}</td>
                <td className="px-4 py-2 text-sm">
                  <span className="font-mono">{l.account_code}</span>
                  <span className="text-gray-600 ml-2">{l.account_name}</span>
                </td>
                <td className="px-4 py-2 text-sm text-gray-700">{l.description ?? '—'}</td>
                <td className="px-4 py-2 text-sm text-gray-700">{l.party_name ?? '—'}</td>
                <td className="px-4 py-2 text-sm font-mono text-gray-700">{l.lot_number ?? '—'}</td>
                <td className="px-4 py-2 text-sm text-right font-medium">
                  {l.debit_amount > 0 ? l.debit_amount.toLocaleString() : ''}
                </td>
                <td className="px-4 py-2 text-sm text-right font-medium">
                  {l.credit_amount > 0 ? l.credit_amount.toLocaleString() : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 font-semibold">
            <tr>
              <td colSpan={5} className="px-4 py-3 text-right text-sm">Totals</td>
              <td className="px-4 py-3 text-sm text-right">{entry.total_debit_pkr.toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-right">{entry.total_credit_pkr.toLocaleString()}</td>
            </tr>
            <tr className={balanced ? 'text-green-700' : 'text-red-700'}>
              <td colSpan={5} className="px-4 py-2 text-right text-sm">Balance Check</td>
              <td colSpan={2} className="px-4 py-2 text-sm text-right">
                {balanced ? '✓ Balanced' : '✗ UNBALANCED'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
