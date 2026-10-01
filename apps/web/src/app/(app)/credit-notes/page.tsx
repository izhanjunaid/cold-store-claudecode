'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { CancelCreditNoteDialog } from '@/components/billing/credit-note-dialog';
import { formatDate, formatMoney } from '@/lib/format';

interface CreditNoteRow {
  id: string;
  credit_note_number: string | null;
  original_invoice_id: string;
  original_invoice_number: string | null;
  billing_party_name: string;
  credit_date: string;
  reason: string;
  total_pkr: number;
  gst_amount_pkr: number;
  status: string;
  book_type: string;
  can_cancel: boolean;
}

const FILTER_KEYS = ['status', 'date_from', 'date_to'] as const;

/**
 * Every credit note, with the invoice it adjusts. A credit note is issued from its
 * invoice (it is built from that invoice's own lines, docs/25 R-03), so this list
 * links there; it can be cancelled from here or from the invoice.
 */
export default function CreditNoteListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'billing.view');
  const canManage = can(user, 'invoices.manage');
  const [cancelTarget, setCancelTarget] = useState<CreditNoteRow | null>(null);

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);
  const { data, isLoading, isError } = useListQuery<CreditNoteRow>(
    ['credit-notes', params],
    '/v1/credit-notes',
    params,
    { enabled: canAccess },
  );

  const columns: DataTableColumn<CreditNoteRow>[] = useMemo(
    () => [
      {
        id: 'number',
        header: 'Credit Note #',
        enableHiding: false,
        cell: (c) => <span className="font-mono">{c.credit_note_number}</span>,
        csv: (c) => c.credit_note_number ?? '',
      },
      { id: 'date', header: 'Date', cell: (c) => formatDate(c.credit_date), csv: (c) => c.credit_date },
      { id: 'party', header: 'Party', cell: (c) => c.billing_party_name, csv: (c) => c.billing_party_name },
      {
        id: 'invoice',
        header: 'Invoice',
        cell: (c) => <span className="font-mono text-primary-700">{c.original_invoice_number}</span>,
        csv: (c) => c.original_invoice_number ?? '',
      },
      { id: 'reason', header: 'Reason', cell: (c) => c.reason, csv: (c) => c.reason },
      {
        id: 'gst',
        header: 'Tax reversed',
        numeric: true,
        cell: (c) => formatMoney(c.gst_amount_pkr),
        csv: (c) => c.gst_amount_pkr,
      },
      {
        id: 'total',
        header: 'Amount',
        numeric: true,
        cell: (c) => <span className="font-medium">{formatMoney(c.total_pkr)}</span>,
        csv: (c) => c.total_pkr,
      },
      { id: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} />, csv: (c) => c.status },
      {
        id: 'actions',
        header: '',
        enableHiding: false,
        cell: (c) =>
          canManage && c.can_cancel ? (
            <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelTarget(c)}>
                Cancel
              </Button>
            </div>
          ) : null,
      },
    ],
    [canManage],
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Credit Notes" />
        <p className="text-muted-foreground">You don&apos;t have permission to view credit notes.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Credit Notes" description="Reductions to finalised invoices — issue one from its invoice" />
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
        getRowId={(c) => c.id}
        onRowClick={(c) => router.push(`/invoices/${c.original_invoice_id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Applied', value: 'APPLIED' },
                { label: 'Cancelled', value: 'CANCELLED' },
              ],
            },
          ],
        }}
        csvFilename="credit-notes"
        emptyState={{ title: 'No credit notes', description: 'Issue a credit note from an invoice.' }}
      />
      <CancelCreditNoteDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        creditNote={cancelTarget}
        onDone={() => {
          setCancelTarget(null);
          queryClient.invalidateQueries({ queryKey: ['credit-notes'] });
        }}
      />
    </div>
  );
}
