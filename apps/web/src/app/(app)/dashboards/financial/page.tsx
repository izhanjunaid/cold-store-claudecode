'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { RefreshCw } from 'lucide-react';
import type { DashboardResponseType, ReceivablesAgingResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const fmtPkr = formatMoney;

// Aging buckets: slate / amber / orange / red (token-aligned).
const BUCKET_COLORS = ['hsl(var(--chart-2))', 'hsl(var(--chart-3))', '#fb923c', 'hsl(var(--chart-5))'];

export default function FinancialDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = hasMinRole(user?.role, 'ACCOUNTANT');

  const dashboardQ = useQuery<DashboardResponseType>({
    queryKey: ['dashboard', user?.facility_id, 'financial'],
    queryFn: () => apiClient<DashboardResponseType>('/v1/reports/dashboard'),
    enabled: canView && !!user,
  });
  const agingQ = useQuery<ReceivablesAgingResponseType>({
    queryKey: ['receivables-aging', user?.facility_id],
    queryFn: () => apiClient<ReceivablesAgingResponseType>('/v1/reports/receivables-aging'),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Financial Dashboard" />
        <p className="text-muted-foreground">The financial dashboard is available to OWNER and ACCOUNTANT only.</p>
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
    <div>
      <PageHeader
        title="Financial Dashboard"
        description="Receivables health and collections"
        actions={
          <Button
            variant="outline"
            onClick={() => {
              dashboardQ.refetch();
              agingQ.refetch();
            }}
            disabled={isFetching}
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden />
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile
          label="AR Outstanding"
          value={fmtPkr(financial?.ar_total_pkr ?? 0)}
          caption="unpaid finalized invoices"
        />
        <StatTile
          label="Collected Today"
          value={fmtPkr(financial?.collected_today_pkr ?? 0)}
          caption="payments received today"
          tone={(financial?.collected_today_pkr ?? 0) > 0 ? 'positive' : 'default'}
        />
        <StatTile
          label="Overdue 90+"
          value={fmtPkr(financial?.overdue_90_plus_pkr ?? 0)}
          caption="invoices 90+ days past due"
          tone={(financial?.overdue_90_plus_pkr ?? 0) > 0 ? 'negative' : 'default'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Receivables Aging</CardTitle>
          </CardHeader>
          <CardContent>
            {aging && aging.buckets.total_pkr > 0 ? (
              <>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90}>
                        {donutData.map((_d, i) => (
                          <Cell key={i} fill={BUCKET_COLORS[i]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ borderRadius: 8, border: '1px solid hsl(var(--border))', fontSize: 12 }}
                        formatter={(v: number) => fmtPkr(v)}
                      />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-center text-sm text-muted-foreground">
                  Total: <strong className="text-foreground">{fmtPkr(aging.buckets.total_pkr)}</strong>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No outstanding receivables.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top 5 Overdue Parties</CardTitle>
          </CardHeader>
          <CardContent>
            {top5.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Party</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Total Due</TableHead>
                    <TableHead className="text-right">Oldest</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top5.map((p) => (
                    <TableRow key={p.party_id} className="cursor-pointer" onClick={() => router.push(`/parties/${p.party_id}`)}>
                      <TableCell className="font-medium">{p.party_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.party_type}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmtPkr(p.total_due_pkr)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{p.oldest_invoice_days}d</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No overdue parties.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
