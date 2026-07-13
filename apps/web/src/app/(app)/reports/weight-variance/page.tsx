'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { WeightVarianceRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

const THRESHOLD = 2;
const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const columns: DataTableColumn<WeightVarianceRowType>[] = [
  { id: 'lot_number', header: 'Lot #', enableHiding: false, cell: (r) => <span className="font-mono text-xs text-primary-700">{r.lot_number}</span>, csv: (r) => r.lot_number },
  { id: 'owner', header: 'Owner', cell: (r) => r.owner_name, csv: (r) => r.owner_name },
  { id: 'inbound', header: 'Inbound (kg)', numeric: true, cell: (r) => num(r.inbound_kg_prorated), csv: (r) => r.inbound_kg_prorated },
  { id: 'outbound', header: 'Outbound (kg)', numeric: true, cell: (r) => num(r.outbound_kg_total), csv: (r) => r.outbound_kg_total },
  {
    id: 'variance_kg',
    header: 'Variance (kg)',
    numeric: true,
    cell: (r) => <span className={Math.abs(r.variance_pct) >= THRESHOLD ? 'font-medium text-destructive' : ''}>{num(r.variance_kg)}</span>,
    csv: (r) => r.variance_kg,
  },
  {
    id: 'variance_pct',
    header: 'Variance %',
    numeric: true,
    cell: (r) => <span className={Math.abs(r.variance_pct) >= THRESHOLD ? 'font-medium text-destructive' : ''}>{r.variance_pct.toFixed(2)}%</span>,
    csv: (r) => r.variance_pct,
  },
  { id: 'outbounds', header: 'Outbounds', numeric: true, cell: (r) => r.finalized_outbound_count, csv: (r) => r.finalized_outbound_count },
];

export default function WeightVariancePage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = can(user, 'reports.inventory');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(
    ['date_from', 'date_to'],
    { defaultPerPage: 50 },
  );
  const params = useMemo(
    () => ({ page: state.page, per_page: state.perPage, ...state.filters }),
    [state],
  );

  const { data, isLoading, isError } = useListQuery<WeightVarianceRowType>(
    qk.reports.report('weight-variance', params),
    '/v1/reports/weight-variance',
    params,
    { enabled: canView && !!user },
  );

  if (!canView) {
    return (
      <div>
        <PageHeader title="Weight Variance" />
        <p className="text-muted-foreground">Weight variance requires MANAGER role or higher.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Weight Variance" description={`Inbound vs outbound weight per lot · flagged at ±${THRESHOLD}%`} />
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
        toolbar={{
          extra: (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" value={state.filters['date_from'] ?? ''} onChange={(e) => setFilter('date_from', e.target.value)} className="h-8 w-auto tabular-nums" />
              <span className="text-muted-foreground">–</span>
              <Input type="date" aria-label="To date" value={state.filters['date_to'] ?? ''} onChange={(e) => setFilter('date_to', e.target.value)} className="h-8 w-auto tabular-nums" />
            </div>
          ),
        }}
        csvFilename="weight-variance"
        emptyState={{ title: 'No finalized outbounds in range' }}
      />
    </div>
  );
}
