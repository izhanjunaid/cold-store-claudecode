'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

interface PartyOption {
  id: string;
  name: string;
  party_type: string;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export default function PartyStatementPickerPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['ACCOUNTANT']!;

  const range = defaultRange();
  const [partyQuery, setPartyQuery] = useState('');
  const [partyResults, setPartyResults] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [bookType, setBookType] = useState<'PACCI' | 'KATCHI'>('PACCI');

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

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">
          Party statement requires ACCOUNTANT role or higher.
        </p>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return;
    const qs = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
      book_type: bookType,
    });
    router.push(`/reports/party-statement/${partyId}?${qs.toString()}`);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Party Statement</h1>
      <form onSubmit={submit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Party</label>
          {partyId ? (
            <div className="flex items-center justify-between border rounded px-3 py-2 bg-gray-50">
              <span>
                <strong>{partyName}</strong>
              </span>
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
            <div className="relative">
              <input
                type="text"
                value={partyQuery}
                onChange={(e) => setPartyQuery(e.target.value)}
                placeholder="Search by name (min 2 chars)…"
                className="w-full border rounded px-3 py-2"
              />
              {partyResults.length > 0 && (
                <ul className="absolute z-10 bg-white shadow-md rounded mt-1 w-full max-h-60 overflow-auto border">
                  {partyResults.map((p) => (
                    <li
                      key={p.id}
                      onClick={() => {
                        setPartyId(p.id);
                        setPartyName(p.name);
                        setPartyResults([]);
                        setPartyQuery('');
                      }}
                      className="px-3 py-2 hover:bg-gray-100 cursor-pointer text-sm"
                    >
                      <strong>{p.name}</strong>{' '}
                      <span className="text-xs text-gray-500">({p.party_type})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date from
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date to
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Book type
          </label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={bookType === 'PACCI'}
                onChange={() => setBookType('PACCI')}
              />
              PACCI (official)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={bookType === 'KATCHI'}
                onChange={() => setBookType('KATCHI')}
              />
              KATCHI (informal)
            </label>
          </div>
        </div>

        <button
          type="submit"
          disabled={!partyId}
          className="px-4 py-2 bg-primary-700 text-white rounded hover:bg-primary-800 disabled:opacity-50"
        >
          View Statement
        </button>
      </form>
    </div>
  );
}
