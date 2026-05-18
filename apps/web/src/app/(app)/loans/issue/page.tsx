'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface PartyOption {
  id: string;
  name: string;
  party_type: string;
}

interface LoanCreated {
  id: string;
  loan_number: string;
  party_name?: string;
  principal_pkr: number;
  issue_journal_entry_id: string | null;
}

export default function IssuePeshgiPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'OWNER';

  const [partyId, setPartyId] = useState(search.get('party_id') ?? '');
  const [partyName, setPartyName] = useState('');
  const [partyQuery, setPartyQuery] = useState('');
  const [partyResults, setPartyResults] = useState<PartyOption[]>([]);
  const [partyOpen, setPartyOpen] = useState(false);

  const [principal, setPrincipal] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<LoanCreated | null>(null);

  // Pre-fetch party name when arriving via ?party_id=
  useEffect(() => {
    if (partyId && !partyName) {
      apiClient<{ id: string; name: string; party_type: string }>(`/v1/parties/${partyId}`)
        .then((p) => setPartyName(p.name))
        .catch(() => {});
    }
  }, [partyId, partyName]);

  // Debounced party search
  useEffect(() => {
    if (partyId || !partyQuery.trim() || partyQuery.length < 2) {
      setPartyResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiClientList<PartyOption>(
          `/v1/parties?search=${encodeURIComponent(partyQuery.trim())}&page_size=10`,
        );
        setPartyResults(res.data);
      } catch {
        setPartyResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [partyQuery, partyId]);

  if (user && !isOwner) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">OWNER role required to issue peshgi.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partyId) {
      setError('Select a party');
      return;
    }
    const principalNum = Number(principal);
    if (!Number.isFinite(principalNum) || principalNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiClient<LoanCreated>('/v1/loans/issue', {
        method: 'POST',
        body: {
          party_id: partyId,
          issue_date: issueDate,
          principal_pkr: principalNum,
          payment_method: paymentMethod,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue peshgi');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-xl shadow p-6 space-y-4">
        <h1 className="text-2xl font-bold text-emerald-700">Peshgi Issued</h1>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm space-y-1">
          <div><strong>Loan No.</strong> <span className="font-mono">{created.loan_number}</span></div>
          <div><strong>Party:</strong> {created.party_name ?? partyName}</div>
          <div><strong>Principal:</strong> PKR {Number(created.principal_pkr).toLocaleString()}</div>
          <div><strong>Journal Entry:</strong> <span className="font-mono">{created.issue_journal_entry_id ?? '—'}</span></div>
        </div>
        <p className="text-sm text-gray-500">
          Open the loan to print the bilingual acknowledgment receipt.
        </p>
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => router.push(`/loans/${created.id}`)}
            className="bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            View Loan
          </button>
          <button
            onClick={() => {
              setCreated(null);
              setPrincipal('');
              setNotes('');
            }}
            className="border text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
          >
            Issue Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="max-w-xl mx-auto bg-white rounded-xl shadow p-6 space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Issue Peshgi</h1>

      {error && <div className="bg-red-50 text-red-800 p-3 rounded-lg text-sm">{error}</div>}

      <div className="relative">
        <label className="block text-sm font-medium text-gray-700">Party *</label>
        {partyId ? (
          <div className="mt-1 flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2">
            <span className="text-sm">{partyName || partyId}</span>
            <button
              type="button"
              onClick={() => {
                setPartyId('');
                setPartyName('');
                setPartyQuery('');
              }}
              className="text-xs text-blue-600 hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={partyQuery}
              onChange={(e) => {
                setPartyQuery((e.target as HTMLInputElement).value);
                setPartyOpen(true);
              }}
              onFocus={() => setPartyOpen(true)}
              placeholder="Search by name…"
              className="mt-1 w-full h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
            {partyOpen && partyResults.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow max-h-60 overflow-auto">
                {partyResults.map((p) => (
                  <li
                    key={p.id}
                    onClick={() => {
                      setPartyId(p.id);
                      setPartyName(p.name);
                      setPartyOpen(false);
                    }}
                    className="px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-gray-500">{p.party_type}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Principal (PKR) *</span>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={principal}
          onChange={(e) => setPrincipal((e.target as HTMLInputElement).value)}
          required
          className="mt-1 w-full h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </label>

      <fieldset>
        <legend className="text-sm font-medium text-gray-700">Payment Method *</legend>
        <div className="mt-2 inline-flex rounded-lg border overflow-hidden">
          {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`px-4 py-2 text-sm font-medium ${
                paymentMethod === m
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {m === 'CASH' ? 'Cash (1010)' : 'Bank Transfer (1020)'}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Issue Date *</span>
        <input
          type="date"
          value={issueDate}
          onChange={(e) => setIssueDate((e.target as HTMLInputElement).value)}
          required
          className="mt-1 w-full h-10 px-3 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          rows={3}
          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
        />
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !partyId}
          className="bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          {submitting ? 'Issuing…' : 'Issue Peshgi'}
        </button>
      </div>
    </form>
  );
}
