'use client';

import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PartyLedgerResponseType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

function fmtPkr(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 2 });
}

export default function PartyStatementDetailPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['ACCOUNTANT']!;

  const dateFrom = search.get('date_from') ?? '';
  const dateTo = search.get('date_to') ?? '';
  const bookType = (search.get('book_type') as 'PACCI' | 'KATCHI') ?? 'PACCI';
  const [downloading, setDownloading] = useState(false);

  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  qs.set('book_type', bookType);

  const { data, isLoading, error } = useQuery<PartyLedgerResponseType>({
    queryKey: ['party-statement', partyId, dateFrom, dateTo, bookType],
    queryFn: () =>
      apiClient<PartyLedgerResponseType>(
        `/v1/reports/party-statement/${partyId}?${qs.toString()}`,
      ),
    enabled: canView && !!user && !!partyId,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
      </div>
    );
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const pdfQs = new URLSearchParams(qs);
      pdfQs.set('format', 'pdf');
      const res = await fetch(
        `${API_URL}/v1/reports/party-statement/${partyId}?${pdfQs.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Facility-ID': facilityId ?? '',
          },
        },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">
          Party Statement —{' '}
          <span className="text-primary-700">{data?.party_name ?? '…'}</span>
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/reports/party-statement')}
            className="px-3 py-1.5 text-sm rounded border"
          >
            New search
          </button>
          <button
            onClick={downloadPdf}
            disabled={!data || downloading}
            className="px-3 py-1.5 text-sm rounded bg-primary-700 text-white disabled:opacity-50"
          >
            {downloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className="text-sm text-gray-600">
        Period: {dateFrom || '—'} to {dateTo || '—'} &nbsp;|&nbsp; Book: <strong>{bookType}</strong>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-4 text-sm">
          {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">Opening Balance</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.opening_balance_pkr ?? 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">Total Debits</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.total_debit_pkr ?? 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">Total Credits</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.total_credit_pkr ?? 0)}
          </div>
        </div>
        <div className="bg-primary-700 text-white rounded-lg shadow p-4">
          <div className="text-xs uppercase opacity-80">Closing Balance</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.closing_balance_pkr ?? 0)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-3 px-4">Date</th>
              <th className="text-left">Type</th>
              <th className="text-left">Reference</th>
              <th className="text-left">Description</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
              <th className="text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.entries.length ? (
              data.entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-2 px-4">{e.date}</td>
                  <td className="text-xs text-gray-600">{e.type}</td>
                  <td className="font-mono text-xs">{e.reference ?? '—'}</td>
                  <td>{e.description}</td>
                  <td className="text-right">
                    {e.debit_pkr > 0 ? fmtPkr(e.debit_pkr) : '—'}
                  </td>
                  <td className="text-right">
                    {e.credit_pkr > 0 ? fmtPkr(e.credit_pkr) : '—'}
                  </td>
                  <td className="text-right font-medium">{fmtPkr(e.balance_pkr)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-500">
                  No entries in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
