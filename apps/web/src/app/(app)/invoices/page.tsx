'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { invoiceColumns, type InvoiceRow } from './columns';

const FILTER_KEYS = ['status', 'date_from', 'date_to'] as const;

export default function InvoiceListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || hasMinRole(user.role, 'ACCOUNTANT');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);

  // Invoice list uses page_size (not per_page) and has no server sort.
  const params = useMemo(
    () => ({ page: state.page, page_size: state.perPage, ...state.filters }),
    [state],
  );

  const { data, isLoading, isError } = useListQuery<InvoiceRow>(
    qk.invoices.list(params),
    '/v1/invoices',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Invoices" />
        <p className="text-muted-foreground">You don&apos;t have permission to view invoices.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Invoices" description="Storage invoices, payments and balances" />

      <DataTable
        columns={invoiceColumns}
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
        getRowId={(inv) => inv.id}
        onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Draft', value: 'DRAFT' },
                { label: 'Finalized', value: 'FINALIZED' },
                { label: 'Void', value: 'VOID' },
              ],
            },
          ],
        }}
        csvFilename="invoices"
        emptyState={{
          title: 'No invoices found',
          description: 'Invoices are created automatically when a withdrawal is dispatched.',
        }}
      />
    </div>
  );
}
