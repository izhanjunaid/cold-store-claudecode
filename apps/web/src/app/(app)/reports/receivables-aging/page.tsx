'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReceivablesAgingResponseType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

function fmtPkr(n: number): string {
  return n.toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function Kpi({ label, value, tone, primary }: { label: string; value: number; tone?: string; primary?: boolean }) {
  return (
    <Card className={cn(primary && 'border-primary bg-primary text-primary-foreground')}>
      <CardContent className="pt-5">
        <div className={cn('text-xs uppercase tracking-wide', primary ? 'opacity-80' : 'text-muted-foreground', tone)}>
          {label}
        </div>
        <div className={cn('mt-1 text-lg font-bold tabular-nums', tone)}>Rs {fmtPkr(value)}</div>
      </CardContent>
    </Card>
  );
}

export default function ReceivablesAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = hasMinRole(user?.role, 'ACCOUNTANT');

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
        <Kpi label="0–30" value={data?.buckets.b_0_30 ?? 0} />
        <Kpi label="31–60" value={data?.buckets.b_31_60 ?? 0} />
        <Kpi label="61–90" value={data?.buckets.b_61_90 ?? 0} />
        <Kpi label="90+" value={data?.buckets.b_90_plus ?? 0} tone="text-destructive" />
        <Kpi label="Total Outstanding" value={data?.buckets.total_pkr ?? 0} primary />
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
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : data?.parties.length ? (
              data.parties.map((p) => (
                <TableRow key={p.party_id} className="cursor-pointer" onClick={() => router.push(`/parties/${p.party_id}`)}>
                  <TableCell className="font-medium">{p.party_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.party_type}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{fmtPkr(p.total_due_pkr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_0_30)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_31_60)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPkr(p.b_61_90)}</TableCell>
                  <TableCell className="text-right tabular-nums text-destructive">{fmtPkr(p.b_90_plus)}</TableCell>
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
