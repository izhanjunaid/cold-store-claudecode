'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

interface PayrollRun {
  id: string;
  run_number: string;
  payroll_type: 'MONTHLY_SALARY' | 'DAILY_WAGES';
  period_year: number;
  period_month: number;
  total_gross_pkr: number;
  total_net_payable_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  finalized_at: string | null;
}

const columns: DataTableColumn<PayrollRun>[] = [
  { id: 'run_number', header: 'Run #', enableHiding: false, cell: (r) => <span className="font-mono text-primary-700">{r.run_number}</span>, csv: (r) => r.run_number },
  { id: 'period', header: 'Period', cell: (r) => <span className="tabular-nums">{r.period_year}-{String(r.period_month).padStart(2, '0')}</span>, csv: (r) => `${r.period_year}-${String(r.period_month).padStart(2, '0')}` },
  { id: 'type', header: 'Type', cell: (r) => (r.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'), csv: (r) => r.payroll_type },
  { id: 'gross', header: 'Gross (PKR)', numeric: true, cell: (r) => r.total_gross_pkr.toLocaleString(), csv: (r) => r.total_gross_pkr },
  { id: 'net', header: 'Net Payable (PKR)', numeric: true, cell: (r) => <span className="font-medium">{r.total_net_payable_pkr.toLocaleString()}</span>, csv: (r) => r.total_net_payable_pkr },
  { id: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} />, csv: (r) => r.status },
];

const FILTER_KEYS = ['status', 'payroll_type'] as const;

export default function PayrollRunsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'payroll.view');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<PayrollRun>(
    qk.accounting.list('payroll-runs', params),
    '/v1/payroll-runs',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Payroll Runs" />
        <p className="text-muted-foreground">You don&apos;t have permission to view payroll.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payroll Runs"
        description="Monthly salary and daily-wage payroll cycles"
        actions={
          <Button asChild>
            <Link href="/accounting/payroll/runs/new">
              <Plus className="h-4 w-4" aria-hidden />
              New Run
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
        getRowId={(r) => r.id}
        onRowClick={(r) => router.push(`/accounting/payroll/runs/${r.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            { key: 'status', label: 'Status', options: ['DRAFT', 'FINALIZED', 'PAID'].map((v) => ({ label: v[0] + v.slice(1).toLowerCase(), value: v })) },
            { key: 'payroll_type', label: 'Type', options: [{ label: 'Monthly Salary', value: 'MONTHLY_SALARY' }, { label: 'Daily Wages', value: 'DAILY_WAGES' }] },
          ],
        }}
        csvFilename="payroll-runs"
        emptyState={{ title: 'No payroll runs yet' }}
      />
    </div>
  );
}
