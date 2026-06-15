'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import type { UserResponseType } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

const ROLE_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = {
  OWNER: 'neutral',
  MANAGER: 'info',
  ACCOUNTANT: 'success',
  OPERATOR: 'warning',
  SECURITY: 'neutral',
};

const columns: DataTableColumn<UserResponseType>[] = [
  { id: 'name', header: 'Name', enableHiding: false, cell: (u) => <span className="font-medium">{u.name}</span>, csv: (u) => u.name },
  { id: 'email', header: 'Email', cell: (u) => u.email, csv: (u) => u.email },
  { id: 'role', header: 'Role', cell: (u) => <StatusBadge status={u.role} tone={ROLE_TONE[u.role] ?? 'neutral'} />, csv: (u) => u.role },
  {
    id: 'status',
    header: 'Status',
    cell: (u) => (
      <span className="flex items-center gap-1.5">
        <StatusBadge status={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
        {u.must_change_password && <span className="text-xs text-amber-600">must change pw</span>}
      </span>
    ),
    csv: (u) => (u.is_active ? 'Active' : 'Disabled'),
  },
  { id: 'last_login', header: 'Last Login', cell: (u) => (u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'), csv: (u) => u.last_login_at ?? '' },
];

export default function UsersListPage() {
  const router = useRouter();
  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(['search'], { defaultPerPage: 50 });
  const params = useMemo(() => ({ page: state.page, per_page: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<UserResponseType>(
    qk.accounting.list('users', params),
    '/v1/users',
    params,
  );

  return (
    <div>
      <PageHeader
        title="Users"
        description="Staff accounts and roles"
        actions={
          <Button asChild>
            <Link href="/settings/users/new">
              <Plus className="h-4 w-4" aria-hidden />
              Create User
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
        perPageOptions={[50, 100]}
        getRowId={(u) => u.id}
        onRowClick={(u) => router.push(`/settings/users/${u.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{ searchKey: 'search', searchPlaceholder: 'Search name or email…' }}
        csvFilename="users"
        emptyState={{ title: 'No users found' }}
      />
    </div>
  );
}
