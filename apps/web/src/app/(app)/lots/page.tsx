'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { lotColumns, type LotRow } from './columns';

const FILTER_KEYS = ['search', 'marka', 'status'] as const;

export default function LotListPage() {
  const router = useRouter();
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters, queryParams } =
    useTableState(FILTER_KEYS);

  const { data, isLoading, isError } = useListQuery<LotRow>(
    qk.lots.list(queryParams),
    '/v1/lots',
    queryParams,
  );

  return (
    <div>
      <PageHeader
        title="Lots"
        description="Stored produce lots, balances, and storage age"
        actions={
          <Button asChild>
            <Link href="/lots/new">
              <Plus className="h-4 w-4" aria-hidden />
              New Inbound
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={lotColumns}
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
        getRowId={(lot) => lot.id}
        onRowClick={(lot) => router.push(`/lots/${lot.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          searchKey: 'search',
          searchPlaceholder: 'Search lot # or marka…',
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Closed', value: 'CLOSED' },
                { label: 'Suspended', value: 'SUSPENDED' },
              ],
            },
          ],
        }}
        csvFilename="lots"
        emptyState={{
          title: 'No lots found',
          description: 'Create an inbound lot to start tracking stored produce.',
          action: (
            <Button asChild size="sm">
              <Link href="/lots/new">
                <Plus className="h-4 w-4" aria-hidden />
                New Inbound
              </Link>
            </Button>
          ),
        }}
      />
    </div>
  );
}
