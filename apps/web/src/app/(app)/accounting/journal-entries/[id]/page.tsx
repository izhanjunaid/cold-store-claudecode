'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

import { formatDate, formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface JournalEntryLine {
  id: string;
  line_number: number;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  party_name: string | null;
  lot_number: string | null;
  description: string | null;
}
interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  book_type: 'PACCI' | 'KATCHI';
  source_table: string;
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  reversed_by_entry_number: string | null;
  total_debit_pkr: number;
  total_credit_pkr: number;
  created_at: string;
  created_by_name: string;
  lines: JournalEntryLine[];
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  POSTED: 'success',
  AUTO_DRAFT: 'warning',
  REVERSED: 'danger',
};

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<JournalEntry>(`/v1/accounting/journal-entries/${params.id}`).then(setEntry).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <PageSkeleton />;
  if (!entry) return <p className="text-muted-foreground">Entry not found</p>;

  const balanced = Math.abs(entry.total_debit_pkr - entry.total_credit_pkr) < 0.01;

  return (
    <div>
      <PageHeader title={entry.entry_number} crumb={entry.entry_number} description={entry.description} />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="mb-4"><StatusBadge status={entry.posting_status} tone={STATUS_TONE[entry.posting_status]} /></div>
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div><dt className="text-muted-foreground">Entry Date</dt><dd className="font-medium">{formatDate(entry.entry_date)}</dd></div>
            <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium">{entry.entry_type}</dd></div>
            <div><dt className="text-muted-foreground">Book</dt><dd className="font-medium">{entry.book_type}</dd></div>
            <div><dt className="text-muted-foreground">Source</dt><dd className="font-mono text-xs">{entry.source_table}</dd></div>
            <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{formatDateTime(entry.created_at)}</dd></div>
            <div><dt className="text-muted-foreground">Created By</dt><dd className="font-medium">{entry.created_by_name}</dd></div>
            {entry.reversed_by_entry_number && (
              <div><dt className="text-muted-foreground">Reversed By</dt><dd className="font-mono text-xs">{entry.reversed_by_entry_number}</dd></div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Lines</h2></div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Lot</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground">{l.line_number}</TableCell>
                <TableCell><span className="font-mono">{l.account_code}</span><span className="ml-2 text-muted-foreground">{l.account_name}</span></TableCell>
                <TableCell>{l.description ?? '—'}</TableCell>
                <TableCell>{l.party_name ?? '—'}</TableCell>
                <TableCell className="font-mono">{l.lot_number ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{l.debit_amount > 0 ? l.debit_amount.toLocaleString() : ''}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{l.credit_amount > 0 ? l.credit_amount.toLocaleString() : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-semibold">Totals</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{entry.total_debit_pkr.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{entry.total_credit_pkr.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="text-right">
                <span className={`inline-flex items-center gap-1.5 ${balanced ? 'text-green-600' : 'text-destructive'}`}>
                  {balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                  {balanced ? 'Balanced' : 'UNBALANCED'}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>
    </div>
  );
}
