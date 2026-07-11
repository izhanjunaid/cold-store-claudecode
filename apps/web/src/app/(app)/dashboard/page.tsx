'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer } from 'recharts';
import { CheckCircle2 } from 'lucide-react';
import type { DashboardResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { apiClient } from '@/lib/api-client';
import { formatCount, formatMoney } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';

const fmt = formatCount;

/** Most chambers the occupancy chart can show while keeping labels readable. */
const CHART_MAX_CHAMBERS = 12;
const tickLabel = (name: string) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);

function TileSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardContent className="pt-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-8 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = hasMinRole(user?.role, 'OPERATOR');

  const { data, isLoading, error } = useQuery<DashboardResponseType>({
    queryKey: ['dashboard', user?.facility_id],
    queryFn: () => apiClient<DashboardResponseType>('/v1/reports/dashboard'),
    refetchInterval: 30_000,
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Operational Dashboard" />
        <p className="text-muted-foreground">Your role ({user?.role}) cannot view the dashboard.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Operational Dashboard"
        description="Live facility overview · auto-refreshes every 30s"
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {isLoading ? (
          <TileSkeletons count={5} />
        ) : (
          <>
            <StatTile label="Active Lots" value={fmt(data?.active_lots ?? 0)} caption="in storage now" />
            <StatTile label="Total Bags" value={fmt(data?.total_bags ?? 0)} caption="across active lots" />
            <StatTile label="Occupancy" value={`${data?.occupancy_pct?.toFixed(1) ?? '0.0'}%`} caption="of total capacity" />
            <StatTile label="Today's Inbound" value={fmt(data?.today_inbound_bags ?? 0)} caption="bags accepted today" />
            <StatTile label="Today's Outbound" value={fmt(data?.today_outbound_bags ?? 0)} caption="bags dispatched today" />
          </>
        )}
      </div>

      {data?.financial && (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Financial Snapshot</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatTile
              label="AR Outstanding"
              value={formatMoney(data.financial.ar_total_pkr)}
              caption="unpaid finalized invoices"
            />
            <StatTile
              label="Collected Today"
              value={formatMoney(data.financial.collected_today_pkr)}
              caption="payments received today"
              tone={data.financial.collected_today_pkr > 0 ? 'positive' : 'default'}
            />
            <StatTile
              label="Overdue 90+"
              value={formatMoney(data.financial.overdue_90_plus_pkr)}
              caption="invoices 90+ days past due"
              tone={data.financial.overdue_90_plus_pkr > 0 ? 'negative' : 'default'}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Room Occupancy</CardTitle>
            {(data?.chambers.length ?? 0) > CHART_MAX_CHAMBERS && (
              <p className="text-xs text-muted-foreground">
                Top {CHART_MAX_CHAMBERS} of {data?.chambers.length} rooms by fill
              </p>
            )}
          </CardHeader>
          <CardContent>
            {data?.chambers.length ? (
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={[...data.chambers]
                      .sort((a, b) => b.occupancy_pct - a.occupancy_pct)
                      .slice(0, CHART_MAX_CHAMBERS)}
                    margin={{ bottom: 24 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      stroke="hsl(var(--muted-foreground))"
                      interval={0}
                      angle={-30}
                      textAnchor="end"
                      tickFormatter={tickLabel}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                      formatter={(value: number, _name, p) => [
                        `${fmt(p.payload.bags)}/${fmt(p.payload.capacity)} bags (${value}%)`,
                        'Occupancy',
                      ]}
                    />
                    <ReferenceLine y={90} stroke="hsl(var(--destructive))" strokeDasharray="3 3" />
                    <Bar
                      dataKey="occupancy_pct"
                      fill="hsl(var(--chart-1))"
                      radius={[4, 4, 0, 0]}
                      onClick={(c: { id?: string }) => c.id && router.push(`/chambers/${c.id}`)}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No chambers configured.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Attention Required</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.attention_required.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot #</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Commodity</TableHead>
                    <TableHead className="text-right">Days</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.attention_required.map((row) => (
                    <TableRow key={row.lot_id} className="cursor-pointer" onClick={() => router.push(`/lots/${row.lot_id}`)}>
                      <TableCell className="font-mono text-xs text-primary-700">{row.lot_number}</TableCell>
                      <TableCell>{row.owner_name}</TableCell>
                      <TableCell>{row.commodity_name}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-destructive">{row.days_in_storage}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{row.threshold}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center gap-2 py-6 text-sm text-green-600">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                No lots over storage threshold.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
