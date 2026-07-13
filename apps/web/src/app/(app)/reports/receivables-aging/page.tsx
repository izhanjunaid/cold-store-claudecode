'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReceivablesAgingResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';
import { formatCount, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const fmtPkr = formatCount;

export default function ReceivablesAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = can(user, 'reports.financial');

  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);

  const { data, isLoading } = useQuery<ReceivablesAgingResponseType>({
    queryKey: ['receivables-aging', user?.facility_id, asOfDate],
    queryFn: () => apiClient<ReceivablesAgingResponseType>(`/v1/reports/receivables-aging?as_of_date=${asOfDate}`),
    enabled: canView && !!user,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Receivables Aging" />
        <p className="text-muted-foreground">Receivables aging requires ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Receivables Aging"
        description="Outstanding invoice balances bucketed by age"
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="as-of" className="text-sm text-muted-foreground">As of</Label>
            <Input
              id="as-of"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="h-9 w-auto tabular-nums"
            />
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile size="compact" label="0–30 days" value={formatMoney(data?.buckets.b_0_30 ?? 0)} />
        <StatTile size="compact" label="31–60 days" value={formatMoney(data?.buckets.b_31_60 ?? 0)} />
        <StatTile size="compact" label="61–90 days" value={formatMoney(data?.buckets.b_61_90 ?? 0)} />
        <StatTile
          size="compact"
          label="90+ days"
          value={formatMoney(data?.buckets.b_90_plus ?? 0)}
          tone={(data?.buckets.b_90_plus ?? 0) > 0 ? 'negative' : 'default'}
        />
        <StatTile
          size="compact"
          label="Total Outstanding"
          value={formatMoney(data?.buckets.total_pkr ?? 0)}
          className="border-primary/40"
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Party</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Total Due</TableHead>
              <TableHead className="text-right">0–30</TableHead>
              <TableHead className="text-right">31–60</TableHead>
              <TableHead className="text-right">61–90</TableHead>
              <TableHead className="text-right">90+</TableHead>
              <TableHead className="text-right">Oldest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }, (_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : data?.parties.length ? (
              data.parties.map((p) => (
                <TableRow key={p.party_id} className="cursor-pointer" onClick={() => router.push(`/parties/${p.party_id}`)}>
                  <TableCell className="font-medium">{p.party_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.party_type}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmtPkr(p.total_due_pkr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_0_30)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_31_60)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_61_90)}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', p.b_90_plus > 0 && 'text-destructive')}>{fmtPkr(p.b_90_plus)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{p.oldest_invoice_days}d</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No outstanding receivables.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
