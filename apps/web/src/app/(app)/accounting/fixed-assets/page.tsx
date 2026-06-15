'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

interface FixedAssetSummary {
  id: string;
  asset_number: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  purchase_cost_pkr: number;
  accumulated_depreciation_pkr: number;
  net_book_value_pkr: number;
  depreciation_method: string;
  status: string;
}

const columns: DataTableColumn<FixedAssetSummary>[] = [
  { id: 'asset_number', header: 'Asset #', enableHiding: false, cell: (a) => <span className="font-mono text-primary-700">{a.asset_number}</span>, csv: (a) => a.asset_number },
  { id: 'name', header: 'Name', cell: (a) => a.asset_name, csv: (a) => a.asset_name },
  { id: 'category', header: 'Category', cell: (a) => a.asset_category, csv: (a) => a.asset_category },
  { id: 'purchase_date', header: 'Purchase Date', cell: (a) => a.purchase_date, csv: (a) => a.purchase_date },
  { id: 'cost', header: 'Cost (PKR)', numeric: true, cell: (a) => a.purchase_cost_pkr.toLocaleString(), csv: (a) => a.purchase_cost_pkr },
  { id: 'depr', header: 'Accum. Depr.', numeric: true, cell: (a) => <span className="text-amber-700">{a.accumulated_depreciation_pkr.toLocaleString()}</span>, csv: (a) => a.accumulated_depreciation_pkr },
  { id: 'nbv', header: 'NBV (PKR)', numeric: true, cell: (a) => <span className="font-medium">{a.net_book_value_pkr.toLocaleString()}</span>, csv: (a) => a.net_book_value_pkr },
  { id: 'method', header: 'Method', cell: (a) => a.depreciation_method, csv: (a) => a.depreciation_method },
  { id: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} />, csv: (a) => a.status },
];

const FILTER_KEYS = ['status', 'category'] as const;

export default function FixedAssetListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || hasMinRole(user.role, 'ACCOUNTANT');
  const canCreate = hasMinRole(user?.role, 'OWNER');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<FixedAssetSummary>(
    qk.accounting.list('fixed-assets', params),
    '/v1/fixed-assets',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Fixed Assets" />
        <p className="text-muted-foreground">You don&apos;t have permission to view fixed assets.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Fixed Assets"
        description="Plant, building, vehicle and computer assets"
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/accounting/fixed-assets/new">
                <Plus className="h-4 w-4" aria-hidden />
                New Asset
              </Link>
            </Button>
          )
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
        getRowId={(a) => a.id}
        onRowClick={(a) => router.push(`/accounting/fixed-assets/${a.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            { key: 'status', label: 'Status', options: ['PURCHASED', 'IN_SERVICE', 'DISPOSED', 'WRITTEN_OFF'].map((v) => ({ label: v.replace(/_/g, ' '), value: v })) },
            { key: 'category', label: 'Category', options: ['COLD_PLANT', 'BUILDING', 'VEHICLE', 'COMPUTER', 'OTHER'].map((v) => ({ label: v.replace(/_/g, ' '), value: v })) },
          ],
        }}
        csvFilename="fixed-assets"
        emptyState={{ title: 'No assets yet' }}
      />
    </div>
  );
}
