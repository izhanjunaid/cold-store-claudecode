'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

interface Employee {
  id: string;
  name: string;
  cnic: string | null;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  designation: string | null;
  basic_salary_pkr: number | null;
  daily_wage_pkr: number | null;
  eobi_registered: boolean;
  is_active: boolean;
}

const columns: DataTableColumn<Employee>[] = [
  { id: 'name', header: 'Name', enableHiding: false, cell: (e) => <span className="font-medium">{e.name}</span>, csv: (e) => e.name },
  { id: 'designation', header: 'Designation', cell: (e) => e.designation ?? '—', csv: (e) => e.designation ?? '' },
  { id: 'type', header: 'Type', cell: (e) => (e.employee_type === 'SALARIED' ? 'Salaried' : 'Daily Wage'), csv: (e) => e.employee_type },
  { id: 'cnic', header: 'CNIC', cell: (e) => <span className="font-mono">{e.cnic ?? '—'}</span>, csv: (e) => e.cnic ?? '' },
  {
    id: 'pay',
    header: 'Pay (PKR)',
    numeric: true,
    cell: (e) => {
      const pay = e.employee_type === 'SALARIED' ? e.basic_salary_pkr : e.daily_wage_pkr;
      return pay ? `${pay.toLocaleString()}${e.employee_type === 'DAILY_WAGE' ? '/day' : '/mo'}` : '—';
    },
    csv: (e) => (e.employee_type === 'SALARIED' ? e.basic_salary_pkr : e.daily_wage_pkr) ?? '',
  },
  { id: 'eobi', header: 'EOBI', cell: (e) => (e.eobi_registered ? <Check className="h-4 w-4 text-green-600" aria-label="Registered" /> : <span className="text-muted-foreground">—</span>), csv: (e) => (e.eobi_registered ? 'Yes' : 'No') },
  { id: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.is_active ? 'ACTIVE' : 'INACTIVE'} />, csv: (e) => (e.is_active ? 'Active' : 'Inactive') },
];

const FILTER_KEYS = ['employee_type', 'is_active'] as const;

export default function EmployeeListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || hasMinRole(user.role, 'ACCOUNTANT');
  const canCreate = hasMinRole(user?.role, 'MANAGER');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS, { defaultPerPage: 50 });
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<Employee>(
    qk.accounting.list('employees', params),
    '/v1/employees',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Employees" />
        <p className="text-muted-foreground">You don&apos;t have permission to view employees.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Salaried staff and daily-wage workers"
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/accounting/payroll/employees/new">
                <Plus className="h-4 w-4" aria-hidden />
                New Employee
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
        perPageOptions={[50, 100]}
        getRowId={(e) => e.id}
        onRowClick={(e) => router.push(`/accounting/payroll/employees/${e.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            { key: 'employee_type', label: 'Type', options: [{ label: 'Salaried', value: 'SALARIED' }, { label: 'Daily Wage', value: 'DAILY_WAGE' }] },
            { key: 'is_active', label: 'Status', options: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }] },
          ],
        }}
        csvFilename="employees"
        emptyState={{ title: 'No employees' }}
      />
    </div>
  );
}
