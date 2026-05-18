'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type {
  DashboardResponseType,
  ReceivablesAgingResponseType,
} from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

function fmtPkr(n: number): string {
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

const BUCKET_COLORS = ['#94a3b8', '#fbbf24', '#fb923c', '#dc2626'];

export default function FinancialDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = user?.role === 'OWNER' || user?.role === 'ACCOUNTANT';

  const dashboardQ = useQuery<DashboardResponseType>({
    queryKey: ['dashboard', user?.facility_id, 'financial'],
    queryFn: () => apiClient<DashboardResponseType>('/v1/reports/dashboard'),
    enabled: canView && !!user,
  });

  const agingQ = useQuery<ReceivablesAgingResponseType>({
    queryKey: ['receivables-aging', user?.facility_id],
    queryFn: () =>
      apiClient<ReceivablesAgingResponseType>('/v1/reports/receivables-aging'),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">
          The financial dashboard is available to OWNER and ACCOUNTANT only.
        </p>
      </div>
    );
  }

  const financial = dashboardQ.data?.financial ?? null;
  const aging = agingQ.data ?? null;
  const isFetching = dashboardQ.isFetching || agingQ.isFetching;

  const donutData = aging
    ? [
        { name: '0–30', value: aging.buckets.b_0_30 },
        { name: '31–60', value: aging.buckets.b_31_60 },
        { name: '61–90', value: aging.buckets.b_61_90 },
        { name: '90+', value: aging.buckets.b_90_plus },
      ]
    : [];
  const top5 = aging ? aging.parties.slice(0, 5) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Financial Dashboard</h1>
        <button
          onClick={() => {
            dashboardQ.refetch();
            agingQ.refetch();
          }}
          className="text-sm px-3 py-1.5 rounded bg-primary-700 text-white hover:bg-primary-800 disabled:opacity-50"
          disabled={isFetching}
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          label="AR Outstanding"
          value={fmtPkr(financial?.ar_total_pkr ?? 0)}
        />
        <KpiCard
          label="Collected Today"
          value={fmtPkr(financial?.collected_today_pkr ?? 0)}
        />
        <KpiCard
          label="Overdue 90+"
          value={fmtPkr(financial?.overdue_90_plus_pkr ?? 0)}
          accent="text-red-700"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Receivables Aging
          </h2>
          {aging && aging.buckets.total_pkr > 0 ? (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                  >
                    {donutData.map((_d, i) => (
                      <Cell key={i} fill={BUCKET_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmtPkr(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center text-sm text-gray-600">
                Total: <strong>{fmtPkr(aging.buckets.total_pkr)}</strong>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No outstanding receivables.</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Top 5 Overdue Parties
          </h2>
          {top5.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2">Party</th>
                  <th>Type</th>
                  <th className="text-right">Total Due</th>
                  <th className="text-right">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {top5.map((p) => (
                  <tr
                    key={p.party_id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/parties/${p.party_id}`)}
                  >
                    <td className="py-2 font-medium">{p.party_name}</td>
                    <td className="text-xs text-gray-500">{p.party_type}</td>
                    <td className="text-right font-mono">{fmtPkr(p.total_due_pkr)}</td>
                    <td className="text-right text-gray-500">
                      {p.oldest_invoice_days}d
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-sm text-gray-500">No overdue parties.</div>
          )}
        </div>
      </div>
    </div>
  );
}
