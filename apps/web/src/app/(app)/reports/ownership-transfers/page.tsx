'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { OwnershipTransferRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

const columns: DataTableColumn<OwnershipTransferRowType>[] = [
  { id: 'date', header: 'Date', cell: (t) => t.transfer_date, csv: (t) => t.transfer_date },
  {
    id: 'type',
    header: 'Type',
    cell: (t) => <StatusBadge status={t.type} tone={t.type === 'PARTIAL' ? 'warning' : 'info'} />,
    csv: (t) => t.type,
  },
  {
    id: 'lot',
    header: 'Lot',
    enableHiding: false,
    cell: (t) => (
      <span className="font-mono text-xs text-primary-700">
        {t.lot_number}
        {t.child_lot_number && <span className="text-muted-foreground"> → {t.child_lot_number}</span>}
      </span>
    ),
    csv: (t) => (t.child_lot_number ? `${t.lot_number} → ${t.child_lot_number}` : t.lot_number),
  },
  { id: 'from', header: 'From', cell: (t) => t.from_party_name ?? '—', csv: (t) => t.from_party_name ?? '' },
  { id: 'to', header: 'To', cell: (t) => t.to_party_name, csv: (t) => t.to_party_name },
  { id: 'bags', header: 'Bags', numeric: true, cell: (t) => t.quantity_bags.toLocaleString(), csv: (t) => t.quantity_bags },
  {
    id: 'price',
    header: 'Price (PKR)',
    numeric: true,
    cell: (t) => (t.transfer_price_pkr !== null ? t.transfer_price_pkr.toLocaleString() : '—'),
    csv: (t) => t.transfer_price_pkr ?? '',
  },
];

export default function OwnershipTransfersPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = hasMinRole(user?.role, 'MANAGER');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(
    ['date_from', 'date_to'],
    { defaultPerPage: 50 },
  );
  const params = useMemo(
    () => ({ page: state.page, per_page: state.perPage, ...state.filters }),
    [state],
  );

  const { data, isLoading, isError } = useListQuery<OwnershipTransferRowType>(
    qk.reports.report('ownership-transfers', params),
    '/v1/reports/ownership-transfers',
    params,
    { enabled: canView && !!user },
  );

  if (!canView) {
    return (
      <div>
        <PageHeader title="Ownership Transfer Log" />
        <p className="text-muted-foreground">Ownership transfer log requires MANAGER role or higher.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Ownership Transfer Log" description="All FULL and PARTIAL ownership transfers across the facility" />
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
        getRowId={(t) => t.transfer_id}
        onRowClick={(t) => router.push(`/lots/${t.lot_id}`)}
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
        csvFilename="ownership-transfers"
        emptyState={{ title: 'No ownership transfers in range' }}
      />
    </div>
  );
}
