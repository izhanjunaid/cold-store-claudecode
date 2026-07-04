'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

import { formatDate } from '@/lib/format';
interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  book_type: 'PACCI' | 'KATCHI';
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  total_debit_pkr: number;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  POSTED: 'success',
  AUTO_DRAFT: 'warning',
  REVERSED: 'danger',
};

const columns: DataTableColumn<JournalEntry>[] = [
  { id: 'entry_number', header: 'Number', enableHiding: false, cell: (e) => <span className="font-mono text-primary-700">{e.entry_number}</span>, csv: (e) => e.entry_number },
  { id: 'date', header: 'Date', cell: (e) => formatDate(e.entry_date), csv: (e) => e.entry_date },
  { id: 'type', header: 'Type', cell: (e) => <StatusBadge status={e.entry_type} tone="info" />, csv: (e) => e.entry_type },
  { id: 'book', header: 'Book', cell: (e) => e.book_type, csv: (e) => e.book_type },
  { id: 'description', header: 'Description', cell: (e) => <span className="block max-w-md truncate">{e.description}</span>, csv: (e) => e.description },
  { id: 'amount', header: 'Amount', numeric: true, cell: (e) => e.total_debit_pkr.toLocaleString(), csv: (e) => e.total_debit_pkr },
  { id: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.posting_status} tone={STATUS_TONE[e.posting_status]} />, csv: (e) => e.posting_status },
];

const FILTER_KEYS = ['entry_type', 'book_type', 'posting_status', 'date_from', 'date_to'] as const;

export default function JournalEntryListPage() {
  const router = useRouter();
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS, {
    defaultPerPage: 25,
  });
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<JournalEntry>(
    qk.accounting.list('journal-entries', params),
    '/v1/accounting/journal-entries',
    params,
  );

  return (
    <div>
      <PageHeader
        title="Journal Entries"
        description="Auto-posted and manual ledger entries"
        actions={
          <Button asChild>
            <Link href="/accounting/journal-entries/new">
              <Plus className="h-4 w-4" aria-hidden />
              New Manual Entry
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        isLoading={isLoading}
        isError={isError}
        sort={state.sort}
        onSortChange={setSort}
        page={state.page}
        perPage={state.perPage}
        onPageChange={setPage}
        onPerPageChange={setPerPage}
        perPageOptions={[25, 50, 100]}
        getRowId={(e) => e.id}
        onRowClick={(e) => router.push(`/accounting/journal-entries/${e.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'entry_type',
              label: 'Type',
              options: ['INVOICE', 'PAYMENT', 'ADVANCE', 'ADVANCE_APPLIED', 'CREDIT_NOTE', 'REVERSAL', 'BAD_DEBT', 'ADJUSTMENT'].map((v) => ({ label: v.replace(/_/g, ' '), value: v })),
            },
            { key: 'book_type', label: 'Book', options: [{ label: 'PACCI', value: 'PACCI' }, { label: 'KATCHI', value: 'KATCHI' }] },
            { key: 'posting_status', label: 'Status', options: [{ label: 'Posted', value: 'POSTED' }, { label: 'Draft', value: 'AUTO_DRAFT' }, { label: 'Reversed', value: 'REVERSED' }] },
          ],
          extra: (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" value={state.filters['date_from'] ?? ''} onChange={(e) => setFilter('date_from', e.target.value)} className="h-8 w-auto tabular-nums" />
              <span className="text-muted-foreground">–</span>
              <Input type="date" aria-label="To date" value={state.filters['date_to'] ?? ''} onChange={(e) => setFilter('date_to', e.target.value)} className="h-8 w-auto tabular-nums" />
            </div>
          ),
        }}
        csvFilename="journal-entries"
        emptyState={{ title: 'No journal entries yet' }}
      />
    </div>
  );
}
