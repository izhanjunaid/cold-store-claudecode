'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

interface LoanSummary {
  id: string;
  loan_number: string;
  party_name?: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
}

const columns: DataTableColumn<LoanSummary>[] = [
  { id: 'loan_number', header: 'Loan No.', enableHiding: false, cell: (l) => <span className="font-mono text-primary-700">{l.loan_number}</span>, csv: (l) => l.loan_number },
  { id: 'party', header: 'Party', cell: (l) => l.party_name ?? '—', csv: (l) => l.party_name ?? '' },
  { id: 'issued', header: 'Issued', cell: (l) => l.issue_date, csv: (l) => l.issue_date },
  { id: 'principal', header: 'Principal', numeric: true, cell: (l) => Number(l.principal_pkr).toLocaleString(), csv: (l) => l.principal_pkr },
  { id: 'balance', header: 'Balance', numeric: true, cell: (l) => <span className="font-medium">{Number(l.balance_outstanding_pkr).toLocaleString()}</span>, csv: (l) => l.balance_outstanding_pkr },
  { id: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} />, csv: (l) => l.status },
];

export default function LoansDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || hasMinRole(user.role, 'ACCOUNTANT');
  const isOwner = user?.role === 'OWNER';

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(['status']);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<LoanSummary>(
    qk.loans.list(params),
    '/v1/loans',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Peshgi Loans" />
        <p className="text-muted-foreground">You don&apos;t have permission to view loans.</p>
      </div>
    );
  }

  const rows = data?.data ?? [];
  const active = rows.filter((l) => l.status === 'ACTIVE');
  const outstanding = active.reduce((s, l) => s + Number(l.balance_outstanding_pkr), 0);

  return (
    <div>
      <PageHeader
        title="Peshgi Loans"
        description="Informal cash advances to farmers and arhtis"
        actions={
          isOwner && (
            <Button asChild>
              <Link href="/loans/issue">
                <Plus className="h-4 w-4" aria-hidden />
                Issue Peshgi
              </Link>
            </Button>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="pt-5"><div className="text-xs uppercase tracking-wide text-muted-foreground">Active Loans</div><div className="mt-1 text-2xl font-bold tabular-nums">{active.length}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs uppercase tracking-wide text-muted-foreground">Outstanding (Active)</div><div className="mt-1 text-2xl font-bold tabular-nums text-green-700">PKR {outstanding.toLocaleString()}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs uppercase tracking-wide text-muted-foreground">Recovered</div><div className="mt-1 text-2xl font-bold tabular-nums">{rows.filter((l) => l.status === 'RECOVERED').length}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs uppercase tracking-wide text-muted-foreground">Written Off</div><div className="mt-1 text-2xl font-bold tabular-nums text-destructive">{rows.filter((l) => l.status === 'WRITTEN_OFF').length}</div></CardContent></Card>
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
        getRowId={(l) => l.id}
        onRowClick={(l) => router.push(`/loans/${l.id}`)}
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
        csvFilename="loans"
        emptyState={{ title: 'No loans found' }}
      />
    </div>
  );
}
