'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DashboardResponseType } from '@coldchain/shared';
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

function fmt(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function fmtPkr(n: number): string {
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 0 })}`;
}

function KpiCard({
  label,
  value,
  subline,
}: {
  label: string;
  value: string;
  subline?: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-2 text-3xl font-bold text-gray-900">{value}</div>
      {subline && <div className="mt-1 text-xs text-gray-500">{subline}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['OPERATOR']!;

  const { data, isLoading, error } = useQuery<DashboardResponseType>({
    queryKey: ['dashboard', user?.facility_id],
    queryFn: () => apiClient<DashboardResponseType>('/v1/reports/dashboard'),
    refetchInterval: 30_000,
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">
          Your role ({user?.role}) does not have permission to view the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Operational Dashboard</h1>
        <span className="text-xs text-gray-500">
          {isLoading ? 'Loading…' : 'Auto-refreshes every 30s'}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-4 text-sm">
          {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard label="Active Lots" value={fmt(data?.active_lots ?? 0)} />
        <KpiCard label="Total Bags" value={fmt(data?.total_bags ?? 0)} />
        <KpiCard
          label="Occupancy"
          value={`${data?.occupancy_pct?.toFixed(1) ?? '0.0'}%`}
        />
        <KpiCard
          label="Today's Inbound"
          value={fmt(data?.today_inbound_bags ?? 0)}
          subline="bags accepted today"
        />
        <KpiCard
          label="Today's Outbound"
          value={fmt(data?.today_outbound_bags ?? 0)}
          subline="bags dispatched today"
        />
      </div>

      {data?.financial && (
        <div>
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Financial Snapshot
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard label="AR Outstanding" value={fmtPkr(data.financial.ar_total_pkr)} />
            <KpiCard
              label="Collected Today"
              value={fmtPkr(data.financial.collected_today_pkr)}
            />
            <KpiCard
              label="Overdue 90+"
              value={fmtPkr(data.financial.overdue_90_plus_pkr)}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Chamber Occupancy
          </h2>
          {data?.chambers.length ? (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={data.chambers}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip
                    formatter={(value: number, _name, p) => [
                      `${fmt(p.payload.bags)}/${fmt(p.payload.capacity)} bags (${value}%)`,
                      'Occupancy',
                    ]}
                  />
                  <ReferenceLine y={90} stroke="#dc2626" strokeDasharray="3 3" />
                  <Bar
                    dataKey="occupancy_pct"
                    fill="#1e40af"
                    onClick={(c: { id?: string }) => c.id && router.push(`/chambers/${c.id}`)}
                    cursor="pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No chambers configured.</div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
            Attention Required
          </h2>
          {data?.attention_required.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2">Lot #</th>
                  <th>Owner</th>
                  <th>Commodity</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Threshold</th>
                </tr>
              </thead>
              <tbody>
                {data.attention_required.map((row) => (
                  <tr
                    key={row.lot_id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => router.push(`/lots/${row.lot_id}`)}
                  >
                    <td className="py-2 font-mono text-xs">{row.lot_number}</td>
                    <td>{row.owner_name}</td>
                    <td>{row.commodity_name}</td>
                    <td className="text-right font-medium text-red-700">
                      {row.days_in_storage}
                    </td>
                    <td className="text-right text-gray-500">{row.threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <span aria-hidden>✓</span>
              <span>No lots over storage threshold.</span>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-5">
        <div className="text-sm font-bold text-gray-700">Spoilage Queue</div>
        <div className="mt-1 text-xs text-gray-500">
          Spoilage review and inspections are part of Phase 11 — Quality module. Once
          shipped, you&apos;ll see pending inspections and confirmed spoilage events here.
        </div>
      </div>
    </div>
  );
}
