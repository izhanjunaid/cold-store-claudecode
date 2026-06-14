'use client';

import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { PartyLedgerResponseType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';
const fmtPkr = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 2 });

function Kpi({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return (
    <Card className={cn(primary && 'border-primary bg-primary text-primary-foreground')}>
      <CardContent className="pt-5">
        <div className={cn('text-xs uppercase tracking-wide', primary ? 'opacity-80' : 'text-muted-foreground')}>{label}</div>
        <div className="mt-1 text-lg font-bold tabular-nums">Rs {fmtPkr(value)}</div>
      </CardContent>
    </Card>
  );
}

export default function PartyStatementDetailPage() {
  const { partyId } = useParams<{ partyId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = hasMinRole(user?.role, 'ACCOUNTANT');

  const dateFrom = search.get('date_from') ?? '';
  const dateTo = search.get('date_to') ?? '';
  const bookType = (search.get('book_type') as 'PACCI' | 'KATCHI') ?? 'PACCI';
  const [downloading, setDownloading] = useState(false);

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

  return (
    <div>
      <PageHeader
        title={`Party Statement — ${data?.party_name ?? '…'}`}
        crumb={data?.party_name ?? 'Statement'}
        description={`Period: ${dateFrom || '—'} to ${dateTo || '—'} · Book: ${bookType}`}
        actions={
          <>
            <Button variant="outline" onClick={() => router.push('/reports/party-statement')}>
              New search
            </Button>
            <Button onClick={downloadPdf} disabled={!data || downloading}>
              {downloading ? 'Generating…' : 'Download PDF'}
            </Button>
          </>
        }
      />

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

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">Loading…</TableCell>
              </TableRow>
            ) : data?.entries.length ? (
              data.entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{e.date}</TableCell>
                  <TableCell><StatusBadge status={e.type} tone={e.type === 'INVOICE' ? 'warning' : 'success'} /></TableCell>
                  <TableCell className="font-mono text-xs">{e.reference ?? '—'}</TableCell>
                  <TableCell>{e.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.debit_pkr > 0 ? fmtPkr(e.debit_pkr) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{e.credit_pkr > 0 ? fmtPkr(e.credit_pkr) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmtPkr(e.balance_pkr)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No entries in this period.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
