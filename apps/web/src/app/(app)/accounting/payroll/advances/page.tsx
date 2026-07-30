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
import { StatTile } from '@/components/stat-tile';
import { formatCount, formatDate, formatMoney } from '@/lib/format';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

interface AdvanceSummary {
  id: string;
  advance_number: string;
  employee_name?: string;
  issue_date: string;
  principal_pkr: number;
  monthly_installment_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
}

const columns: DataTableColumn<AdvanceSummary>[] = [
  { id: 'advance_number', header: 'Advance No.', enableHiding: false, cell: (a) => <span className="font-mono text-primary-700">{a.advance_number}</span>, csv: (a) => a.advance_number },
  { id: 'employee', header: 'Employee', cell: (a) => a.employee_name ?? '—', csv: (a) => a.employee_name ?? '' },
  { id: 'issued', header: 'Issued', cell: (a) => formatDate(a.issue_date), csv: (a) => a.issue_date },
  { id: 'principal', header: 'Principal', numeric: true, cell: (a) => formatCount(Number(a.principal_pkr)), csv: (a) => a.principal_pkr },
  { id: 'installment', header: 'Instalment/mo', numeric: true, cell: (a) => formatCount(Number(a.monthly_installment_pkr)), csv: (a) => a.monthly_installment_pkr },
  { id: 'balance', header: 'Balance', numeric: true, cell: (a) => <span className="font-medium">{formatCount(Number(a.balance_outstanding_pkr))}</span>, csv: (a) => a.balance_outstanding_pkr },
  { id: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} />, csv: (a) => a.status },
];

export default function EmployeeAdvancesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'employee_advances.view');
  const canIssue = can(user, 'employee_advances.issue');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(['status']);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<AdvanceSummary>(
    qk.employeeAdvances.list(params),
    '/v1/employee-advances',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Employee Advances" />
        <p className="text-muted-foreground">You don&apos;t have permission to view employee advances.</p>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const active = rows.filter((a) => a.status === 'ACTIVE');
  const outstanding = active.reduce((s, a) => s + Number(a.balance_outstanding_pkr), 0);

  return (
    <div>
      <PageHeader
        title="Employee Advances"
        description="Cash advances against salary, recovered automatically through payroll"
        actions={
          canIssue && (
            <Button asChild>
              <Link href="/accounting/payroll/advances/new">
                <Plus className="h-4 w-4" aria-hidden />
                Issue Advance
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile size="compact" label="Active Advances" value={formatCount(active.length)} />
        <StatTile size="compact" label="Outstanding (Active)" value={formatMoney(outstanding)} />
        <StatTile
          size="compact"
          label="Recovered"
          value={formatCount(rows.filter((a) => a.status === 'RECOVERED').length)}
        />
        <StatTile
          size="compact"
          label="Written Off"
          value={formatCount(rows.filter((a) => a.status === 'WRITTEN_OFF').length)}
          tone={rows.some((a) => a.status === 'WRITTEN_OFF') ? 'warning' : 'default'}
        />
      </div>

      <DataTable
        columns={columns}
        data={rows}
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
        onRowClick={(a) => router.push(`/accounting/payroll/advances/${a.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Recovered', value: 'RECOVERED' },
                { label: 'Written Off', value: 'WRITTEN_OFF' },
              ],
            },
          ],
        }}
        csvFilename="employee-advances"
        emptyState={{ title: 'No employee advances found' }}
      />
    </div>
  );
}
