'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReceivablesAgingResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

function fmtPkr(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

export default function ReceivablesAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['ACCOUNTANT']!;

  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);

  const { data, isLoading } = useQuery<ReceivablesAgingResponseType>({
    queryKey: ['receivables-aging', user?.facility_id, asOfDate],
    queryFn: () =>
      apiClient<ReceivablesAgingResponseType>(
        `/v1/reports/receivables-aging?as_of_date=${asOfDate}`,
      ),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">
          Receivables aging requires ACCOUNTANT role or higher.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Receivables Aging</h1>
        <label className="text-sm text-gray-600">
          As of:&nbsp;
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">0–30</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.buckets.b_0_30 ?? 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">31–60</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.buckets.b_31_60 ?? 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500">61–90</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.buckets.b_61_90 ?? 0)}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-xs uppercase text-gray-500 text-red-600">90+</div>
          <div className="text-lg font-bold mt-1 text-red-700">
            Rs {fmtPkr(data?.buckets.b_90_plus ?? 0)}
          </div>
        </div>
        <div className="bg-primary-700 text-white rounded-lg shadow p-4">
          <div className="text-xs uppercase opacity-80">Total Outstanding</div>
          <div className="text-lg font-bold mt-1">
            Rs {fmtPkr(data?.buckets.total_pkr ?? 0)}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-3 px-4">Party</th>
              <th className="text-left">Type</th>
              <th className="text-right">Total Due</th>
              <th className="text-right">0–30</th>
              <th className="text-right">31–60</th>
              <th className="text-right">61–90</th>
              <th className="text-right">90+</th>
              <th className="text-right">Oldest</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  Loading…
                </td>
              </tr>
            ) : data?.parties.length ? (
              data.parties.map((p) => (
                <tr
                  key={p.party_id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/parties/${p.party_id}`)}
                >
                  <td className="py-2 px-4 font-medium">{p.party_name}</td>
                  <td className="text-xs text-gray-500">{p.party_type}</td>
                  <td className="text-right font-mono">{fmtPkr(p.total_due_pkr)}</td>
                  <td className="text-right">{fmtPkr(p.b_0_30)}</td>
                  <td className="text-right">{fmtPkr(p.b_31_60)}</td>
                  <td className="text-right">{fmtPkr(p.b_61_90)}</td>
                  <td className="text-right text-red-700">{fmtPkr(p.b_90_plus)}</td>
                  <td className="text-right text-gray-500">{p.oldest_invoice_days}d</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-500">
                  No outstanding receivables.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
