'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { LotAgingRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

import { formatDate } from '@/lib/format';
const columns: DataTableColumn<LotAgingRowType>[] = [
  { id: 'lot_number', header: 'Lot #', enableHiding: false, cell: (r) => <span className="font-mono text-xs text-primary-700">{r.lot_number}</span>, csv: (r) => r.lot_number },
  { id: 'owner', header: 'Owner', cell: (r) => r.owner_name, csv: (r) => r.owner_name },
  { id: 'commodity', header: 'Commodity', cell: (r) => r.commodity_name, csv: (r) => r.commodity_name },
  { id: 'chamber', header: 'Room', cell: (r) => r.chamber_name, csv: (r) => r.chamber_name },
  { id: 'bags', header: 'Bags', numeric: true, cell: (r) => r.current_bags.toLocaleString(), csv: (r) => r.current_bags },
  { id: 'inbound', header: 'Inbound', cell: (r) => formatDate(r.inbound_date), csv: (r) => r.inbound_date },
  {
    id: 'days',
    header: 'Days',
    numeric: true,
    cell: (r) => (
      <span className={r.threshold_exceeded ? 'font-medium text-destructive' : 'font-medium'}>{r.days_in_storage}</span>
    ),
    csv: (r) => r.days_in_storage,
  },
  { id: 'threshold', header: 'Threshold', numeric: true, cell: (r) => <span className="text-muted-foreground">{r.threshold}</span>, csv: (r) => r.threshold },
];

export default function LotAgingPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = can(user, 'reports.inventory');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState([], { defaultPerPage: 50 });
  const params = useMemo(() => ({ page: state.page, per_page: state.perPage }), [state]);

  const { data, isLoading, isError } = useListQuery<LotAgingRowType>(
    qk.reports.report('lot-aging', params),
    '/v1/reports/lot-aging',
    params,
    { enabled: canView && !!user },
  );

  if (!canView) {
    return (
      <div>
        <PageHeader title="Lot Aging" />
        <p className="text-muted-foreground">Lot aging requires MANAGER role or higher.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Lot Aging" description="Active lots by storage age, flagged past their alert threshold" />
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
        perPageOptions={[50, 100]}
        getRowId={(r) => r.lot_id}
        onRowClick={(r) => router.push(`/lots/${r.lot_id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        csvFilename="lot-aging"
        emptyState={{ title: 'No active lots' }}
      />
    </div>
  );
}
