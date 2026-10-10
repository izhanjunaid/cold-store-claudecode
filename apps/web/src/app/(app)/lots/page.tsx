'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { useChambers, useParties, useCommodities } from '@/hooks/use-reference-data';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import { getLotColumns, DEFAULT_STORAGE_ALERT_DAYS, type LotRow } from './columns';

const FILTER_KEYS = ['search', 'marka', 'status', 'chamber_id', 'party_id', 'commodity_id'] as const;

export default function LotListPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canOperate = can(user, 'outbound.record');
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters, queryParams } =
    useTableState(FILTER_KEYS);
  const { data: chambers = [] } = useChambers();
  const { data: parties = [] } = useParties();
  const { data: commodities = [] } = useCommodities();

  const commodityThresholds = useMemo(
    () =>
      new Map(
        commodities.map((c) => [c.id, c.default_storage_days_alert ?? DEFAULT_STORAGE_ALERT_DAYS]),
      ),
    [commodities],
  );
  const columns = useMemo(
    () => getLotColumns({ commodityThresholds, canOperate }),
    [commodityThresholds, canOperate],
  );

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
        getRowId={(lot) => lot.id}
        onRowClick={(lot) => router.push(`/lots/${lot.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          searchKey: 'search',
          searchPlaceholder: 'Search lot #, marka, party, or vehicle…',
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
            {
              key: 'chamber_id',
              label: 'Room',
              options: chambers.map((c) => ({ label: c.name, value: c.id })),
            },
            {
              key: 'party_id',
              label: 'Owner',
              options: parties.map((p) => ({ label: p.name, value: p.id })),
            },
            {
              key: 'commodity_id',
              label: 'Commodity',
              options: commodities.map((c) => ({ label: c.name, value: c.id })),
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
