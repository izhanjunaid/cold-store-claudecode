'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { ReceivablesAgingResponseType, ReceivablesAgingPartyRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';
import { useParties } from '@/hooks/use-reference-data';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { formatCount, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const fmtPkr = formatCount;
type AgingPartyRow = ReceivablesAgingPartyRowType;

export default function ReceivablesAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = can(user, 'reports.financial');

  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [partyId, setPartyId] = useState('');

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

  const { data, isLoading } = useQuery<ReceivablesAgingResponseType>({
    queryKey: ['receivables-aging', user?.facility_id, asOfDate, partyId],
    queryFn: () => {
      const qs = new URLSearchParams({ as_of_date: asOfDate, per_page: '500' });
      if (partyId) qs.set('party_id', partyId);
      return apiClient<ReceivablesAgingResponseType>(`/v1/reports/receivables-aging?${qs.toString()}`);
    },
    enabled: canView && !!user,
  });

  const rows = data?.parties ?? [];

  const columns: DataTableColumn<AgingPartyRow>[] = useMemo(
    () => [
      { id: 'party', header: 'Party', enableHiding: false, cell: (p) => <span className="font-medium">{p.party_name}</span>, csv: (p) => p.party_name },
      { id: 'type', header: 'Type', cell: (p) => <span className="text-xs text-muted-foreground">{p.party_type}</span>, csv: (p) => p.party_type },
      {
        id: 'total_due', header: 'Gross Due', numeric: true, cell: (p) => fmtPkr(p.total_due_pkr), csv: (p) => p.total_due_pkr,
        footer: (r) => formatMoney(r.reduce((s, x) => s + x.total_due_pkr, 0)),
      },
      { id: 'b_0_30', header: '0–30', numeric: true, cell: (p) => fmtPkr(p.b_0_30), csv: (p) => p.b_0_30, footer: (r) => formatMoney(r.reduce((s, x) => s + x.b_0_30, 0)) },
      { id: 'b_31_60', header: '31–60', numeric: true, cell: (p) => fmtPkr(p.b_31_60), csv: (p) => p.b_31_60, footer: (r) => formatMoney(r.reduce((s, x) => s + x.b_31_60, 0)) },
      { id: 'b_61_90', header: '61–90', numeric: true, cell: (p) => fmtPkr(p.b_61_90), csv: (p) => p.b_61_90, footer: (r) => formatMoney(r.reduce((s, x) => s + x.b_61_90, 0)) },
      {
        id: 'b_90_plus', header: '90+', numeric: true,
        cell: (p) => <span className={p.b_90_plus > 0 ? 'text-destructive' : ''}>{fmtPkr(p.b_90_plus)}</span>,
        csv: (p) => p.b_90_plus,
        footer: (r) => formatMoney(r.reduce((s, x) => s + x.b_90_plus, 0)),
      },
      {
        id: 'credits', header: 'Credits', numeric: true,
        cell: (p) => (p.unapplied_credit_pkr > 0 ? <span className="text-muted-foreground">({fmtPkr(p.unapplied_credit_pkr)})</span> : '—'),
        csv: (p) => p.unapplied_credit_pkr,
      },
      {
        id: 'net_due', header: 'Net Due', numeric: true,
        cell: (p) => <span className={cn('font-mono font-medium', p.net_due_pkr < 0 && 'text-emerald-600 dark:text-emerald-400')}>{fmtPkr(p.net_due_pkr)}</span>,
        csv: (p) => p.net_due_pkr,
        footer: (r) => formatMoney(r.reduce((s, x) => s + x.net_due_pkr, 0)),
      },
      { id: 'oldest', header: 'Oldest', numeric: true, cell: (p) => `${p.oldest_invoice_days}d`, csv: (p) => p.oldest_invoice_days },
    ],
    [],
  );

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
              className="h-8 w-auto tabular-nums"
            />
          </div>
        }
      />

      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
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
          label="Net Receivable"
          value={formatMoney(data?.net_total_pkr ?? 0)}
          tone={data && !data.reconciled ? 'negative' : 'default'}
          className="border-primary/40"
        />
      </div>

      {data && !data.reconciled && (
        <div className="mb-4 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">
          Variance of {formatMoney(data.variance_pkr)} vs the GL AR control (1110/1120/1130/1150) —
          gross {formatMoney(data.buckets.total_pkr)}, unapplied credits {formatMoney(data.total_unapplied_credit_pkr)},
          GL control {formatMoney(data.gl_ar_control_total_pkr)}. Investigate before relying on these figures.
        </div>
      )}

      <div className="mb-3 max-w-xs">
        <Combobox
          options={partyOptions}
          value={partyId}
          onChange={setPartyId}
          placeholder="All parties"
          searchPlaceholder="Search parties…"
          className="h-8"
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
        meta={undefined}
        isLoading={isLoading}
        sort={null}
        onSortChange={() => {}}
        page={1}
        perPage={500}
        onPageChange={() => {}}
        onPerPageChange={() => {}}
        getRowId={(p) => p.party_id}
        onRowClick={(p) => router.push(`/parties/${p.party_id}`)}
        csvFilename="receivables-aging"
        emptyState={{ title: 'No outstanding receivables.' }}
      />
    </div>
  );
}
