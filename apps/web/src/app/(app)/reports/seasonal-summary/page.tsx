'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SeasonalSummaryResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

function defaultPeriod() {
  const today = new Date();
  const start = new Date(today);
  start.setMonth(start.getMonth() - 6);
  return { from: start.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

export default function SeasonalSummaryPage() {
  const user = useAuthStore((s) => s.user);
  const canView = hasMinRole(user?.role, 'OWNER');

  const initial = defaultPeriod();
  const [dateFrom, setDateFrom] = useState(initial.from);
  const [dateTo, setDateTo] = useState(initial.to);

  const { data, isLoading } = useQuery<SeasonalSummaryResponseType>({
    queryKey: ['seasonal-summary', user?.facility_id, dateFrom, dateTo],
    queryFn: () =>
      apiClient<SeasonalSummaryResponseType>(
        `/v1/reports/seasonal-summary?date_from=${dateFrom}&date_to=${dateTo}`,
      ),
    enabled: canView && !!user && !!dateFrom && !!dateTo,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Seasonal Summary" />
        <p className="text-muted-foreground">Seasonal summary requires OWNER role.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Seasonal Summary"
        description="Inbound, outbound and revenue across a date range"
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-auto tabular-nums" />
            <span className="text-muted-foreground">–</span>
            <Input type="date" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-auto tabular-nums" />
          </div>
        }
      />

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : data ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Inbound (bags)" value={data.total_inbound_bags.toLocaleString()} />
            <Kpi label="Outbound (bags)" value={data.total_outbound_bags.toLocaleString()} />
            <Kpi label="Revenue (PKR)" value={data.total_revenue_pkr.toLocaleString()} tone="text-green-700" />
            <Kpi label="Avg Storage Days" value={data.avg_storage_days !== null ? data.avg_storage_days.toFixed(1) : '—'} />
          </div>

          <Card>
            <div className="border-b px-4 py-2 text-xs uppercase tracking-wide text-muted-foreground">
              Period: {data.period.from} to {data.period.to}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Commodity</TableHead>
                  <TableHead className="text-right">Inbound (bags)</TableHead>
                  <TableHead className="text-right">Outbound (bags)</TableHead>
                  <TableHead className="text-right">Revenue (PKR)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.commodities.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">No activity in period.</TableCell>
                  </TableRow>
                ) : (
                  data.commodities.map((c) => (
                    <TableRow key={c.commodity_id}>
                      <TableCell>{c.commodity_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.inbound_bags.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.outbound_bags.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-green-700">{c.revenue_pkr.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      ) : null}
    </div>
  );
}
