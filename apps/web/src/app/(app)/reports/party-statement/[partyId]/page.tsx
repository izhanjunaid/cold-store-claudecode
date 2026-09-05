'use client';

import { useMemo, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PartyLedgerResponseType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { hasMinRole } from '@/lib/rbac';
import { useParties } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatMoney } from '@/lib/format';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';
const fmtPkr = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 2 });

type LedgerEntry = PartyLedgerResponseType['entries'][number];

function Kpi({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <StatTile size="compact" label={label} value={formatMoney(value)} className={primary ? 'border-primary/40' : undefined} />
  );
}

function buildStatementUrl(partyId: string, dateFrom: string, dateTo: string, bookType: string) {
  const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, book_type: bookType });
  return `/reports/party-statement/${partyId}?${qs.toString()}`;
}

export default function PartyStatementDetailPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = can(user, 'reports.financial');

  const dateFrom = search.get('date_from') ?? '';
  const dateTo = search.get('date_to') ?? '';
  const bookType = (search.get('book_type') as 'PACCI' | 'KATCHI') ?? 'PACCI';
  const [downloading, setDownloading] = useState(false);

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

  const qs = new URLSearchParams();
  if (dateFrom) qs.set('date_from', dateFrom);
  if (dateTo) qs.set('date_to', dateTo);
  qs.set('book_type', bookType);

  const { data, isLoading, error } = useQuery<PartyLedgerResponseType>({
    queryKey: ['party-statement', partyId, dateFrom, dateTo, bookType],
    queryFn: () => apiClient<PartyLedgerResponseType>(`/v1/reports/party-statement/${partyId}?${qs.toString()}`),
    enabled: canView && !!user && !!partyId,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Party Statement" />
        <p className="text-muted-foreground">Party statement requires ACCOUNTANT role or higher.</p>
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
      const res = await fetch(`${API_URL}/v1/reports/party-statement/${partyId}?${pdfQs.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Facility-ID': facilityId ?? '' },
      });
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } finally {
      setDownloading(false);
    }
  }

  const columns: DataTableColumn<LedgerEntry>[] = [
    { id: 'date', header: 'Date', cell: (e) => e.date, csv: (e) => e.date },
    { id: 'type', header: 'Type', cell: (e) => <StatusBadge status={e.type} tone={e.type === 'INVOICE' ? 'warning' : 'success'} />, csv: (e) => e.type },
    { id: 'reference', header: 'Reference', cell: (e) => <span className="font-mono text-xs">{e.reference ?? '—'}</span>, csv: (e) => e.reference ?? '' },
    { id: 'description', header: 'Description', cell: (e) => e.description, csv: (e) => e.description },
    {
      id: 'debit', header: 'Debit', numeric: true, cell: (e) => (e.debit_pkr > 0 ? fmtPkr(e.debit_pkr) : '—'), csv: (e) => e.debit_pkr,
      footer: (r) => formatMoney(r.reduce((s, x) => s + x.debit_pkr, 0)),
    },
    {
      id: 'credit', header: 'Credit', numeric: true, cell: (e) => (e.credit_pkr > 0 ? fmtPkr(e.credit_pkr) : '—'), csv: (e) => e.credit_pkr,
      footer: (r) => formatMoney(r.reduce((s, x) => s + x.credit_pkr, 0)),
    },
    { id: 'balance', header: 'Balance', numeric: true, cell: (e) => <span className="font-medium">{fmtPkr(e.balance_pkr)}</span>, csv: (e) => e.balance_pkr },
  ];

  return (
    <div>
      <PageHeader
        title={`Party Statement — ${data?.party_name ?? '…'}`}
        crumb={data?.party_name ?? 'Statement'}
        actions={
          <Button onClick={downloadPdf} disabled={!data || downloading}>
            {downloading ? 'Generating…' : 'Download PDF'}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56 space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Party</span>
          <Combobox
            options={partyOptions}
            value={partyId}
            onChange={(v) => v !== partyId && router.push(buildStatementUrl(v, dateFrom, dateTo, bookType))}
            placeholder="Select party…"
            searchPlaceholder="Search parties…"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">From</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => router.replace(buildStatementUrl(partyId, e.target.value, dateTo, bookType))}
            className="h-8 tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">To</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => router.replace(buildStatementUrl(partyId, dateFrom, e.target.value, bookType))}
            className="h-8 tabular-nums"
          />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={bookType === 'PACCI' ? 'default' : 'outline'}
            onClick={() => router.replace(buildStatementUrl(partyId, dateFrom, dateTo, 'PACCI'))}
          >
            PACCI
          </Button>
          {hasMinRole(user?.role, 'MANAGER') && (
            <Button
              type="button"
              size="sm"
              variant={bookType === 'KATCHI' ? 'default' : 'outline'}
              onClick={() => router.replace(buildStatementUrl(partyId, dateFrom, dateTo, 'KATCHI'))}
            >
              KATCHI
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(error as Error).message}
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Opening Balance" value={data?.opening_balance_pkr ?? 0} />
        <Kpi label="Total Debits" value={data?.total_debit_pkr ?? 0} />
        <Kpi label="Total Credits" value={data?.total_credit_pkr ?? 0} />
        <Kpi label="Closing Balance" value={data?.closing_balance_pkr ?? 0} primary />
      </div>

      <DataTable
        columns={columns}
        data={data?.entries ?? []}
        meta={undefined}
        isLoading={isLoading}
        sort={null}
        onSortChange={() => {}}
        page={1}
        perPage={1000}
        onPageChange={() => {}}
        onPerPageChange={() => {}}
        getRowId={(e) => e.id}
        csvFilename="party-statement"
        emptyState={{ title: 'No entries in this period.' }}
      />
    </div>
  );
}
