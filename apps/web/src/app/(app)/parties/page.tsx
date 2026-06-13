'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { partyColumns, type PartyRow } from './columns';

const FILTER_KEYS = ['search', 'type', 'is_active'] as const;

export default function PartyListPage() {
  const router = useRouter();
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters, queryParams } =
    useTableState(FILTER_KEYS);

  const { data, isLoading, isError } = useListQuery<PartyRow>(
    qk.parties.list(queryParams),
    '/v1/parties',
    queryParams,
  );

  return (
    <div>
      <PageHeader
        title="Parties"
        description="Farmers, traders, arhtis and buyers"
        actions={
          <Button asChild>
            <Link href="/parties/new">
              <Plus className="h-4 w-4" aria-hidden />
              New Party
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={partyColumns}
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
        getRowId={(p) => p.id}
        onRowClick={(p) => router.push(`/parties/${p.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          searchKey: 'search',
          searchPlaceholder: 'Search name or phone…',
          facets: [
            {
              key: 'type',
              label: 'Type',
              options: [
                { label: 'Farmer', value: 'FARMER' },
                { label: 'Trader', value: 'TRADER' },
                { label: 'Arhti', value: 'ARHTI' },
                { label: 'Buyer', value: 'BUYER' },
                { label: 'Other', value: 'OTHER' },
              ],
            },
            {
              key: 'is_active',
              label: 'Status',
              options: [
                { label: 'Active', value: 'true' },
                { label: 'Inactive', value: 'false' },
              ],
            },
          ],
        }}
        csvFilename="parties"
        emptyState={{
          title: 'No parties found',
          description: 'Add a party to start recording lots and invoices.',
          action: (
            <Button asChild size="sm">
              <Link href="/parties/new">
                <Plus className="h-4 w-4" aria-hidden />
                New Party
              </Link>
            </Button>
          ),
        }}
      />
    </div>
  );
}
