'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { useSuppliers, type Bill } from '../payables-shared';

const FILTER_KEYS = ['status', 'supplier_party_id', 'date_from', 'date_to'] as const;

export default function BillsPage() {
  const router = useRouter();
  const canRecord = useCan('expenses.record');
  const { data: suppliers = [] } = useSuppliers();
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);
  const { data, isLoading, isError } = useListQuery<Bill>(qk.accounting.list('bills', params), '/v1/bills', params, {
    enabled: canRecord,
  });

  const columns: DataTableColumn<Bill>[] = [
    {
      id: 'number',
      header: 'Bill #',
      enableHiding: false,
      cell: (b) => <span className="font-mono text-primary-700">{b.bill_number ?? 'Draft'}</span>,
      csv: (b) => b.bill_number ?? '',
    },
    { id: 'date', header: 'Date', cell: (b) => formatDate(b.bill_date), csv: (b) => b.bill_date },
    { id: 'due', header: 'Due', cell: (b) => (b.due_date ? formatDate(b.due_date) : '—'), csv: (b) => b.due_date ?? '' },
    { id: 'supplier', header: 'Supplier', cell: (b) => b.supplier_name, csv: (b) => b.supplier_name },
    { id: 'description', header: 'Description', cell: (b) => b.description, csv: (b) => b.description },
    { id: 'total', header: 'Total', numeric: true, cell: (b) => formatMoney(b.total_pkr), csv: (b) => b.total_pkr },
    { id: 'open', header: 'Open', numeric: true, cell: (b) => formatMoney(b.open_pkr), csv: (b) => b.open_pkr },
    {
      id: 'status',
      header: 'Status',
      cell: (b) => <StatusBadge status={b.payment_status ?? b.status} />,
      csv: (b) => b.payment_status ?? b.status,
    },
  ];

  if (!canRecord) {
    return (
      <div>
        <PageHeader title="Bills" />
        <p className="text-muted-foreground">You don&apos;t have permission to view bills.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Bills"
        description="What suppliers have billed the facility — each one a cost at its own date, owed until paid"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/accounting/payables/payments">Supplier payments</Link>
            </Button>
            <Button asChild>
              <Link href="/accounting/payables/bills/new">
                <Plus className="h-4 w-4" aria-hidden />
                New bill
              </Link>
            </Button>
          </div>
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
        getRowId={(b) => b.id}
        onRowClick={(b) => router.push(`/accounting/payables/bills/${b.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            { key: 'status', label: 'Status', options: ['DRAFT', 'POSTED', 'VOID'].map((v) => ({ label: v[0] + v.slice(1).toLowerCase(), value: v })) },
            { key: 'supplier_party_id', label: 'Supplier', options: suppliers.map((s) => ({ label: s.name, value: s.id })) },
          ],
        }}
        csvFilename="bills"
        emptyState={{ title: 'No bills yet' }}
      />
    </div>
  );
}
