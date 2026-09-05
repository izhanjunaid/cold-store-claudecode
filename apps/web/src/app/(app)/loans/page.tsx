'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { useParties } from '@/hooks/use-reference-data';
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
  { id: 'issued', header: 'Issued', cell: (l) => formatDate(l.issue_date), csv: (l) => l.issue_date },
  {
    id: 'principal',
    header: 'Principal',
    numeric: true,
    cell: (l) => Number(l.principal_pkr).toLocaleString(),
    csv: (l) => l.principal_pkr,
    footer: (rows) => formatMoney(rows.reduce((s, r) => s + Number(r.principal_pkr), 0)),
  },
  {
    id: 'balance',
    header: 'Balance',
    numeric: true,
    cell: (l) => <span className="font-medium">{Number(l.balance_outstanding_pkr).toLocaleString()}</span>,
    csv: (l) => l.balance_outstanding_pkr,
    footer: (rows) => formatMoney(rows.reduce((s, r) => s + Number(r.balance_outstanding_pkr), 0)),
  },
  { id: 'status', header: 'Status', cell: (l) => <StatusBadge status={l.status} />, csv: (l) => l.status },
];

export default function LoansDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'loans.view');
  const isOwner = can(user, 'loans.issue');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(['status', 'party_id']);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<LoanSummary>(
    qk.loans.list(params),
    '/v1/loans',
    params,
    { enabled: canAccess },
  );

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Peshgi Loans" />
        <p className="text-muted-foreground">You don&apos;t have permission to view loans.</p>
      </div>
    );
  }

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
          extra: (
            <Combobox
              options={partyOptions}
              value={state.filters['party_id'] ?? ''}
              onChange={(v) => setFilter('party_id', v)}
              placeholder="All parties"
              searchPlaceholder="Search parties…"
              className="h-8 w-[200px]"
            />
          ),
        }}
        csvFilename="loans"
        emptyState={{ title: 'No loans found' }}
      />
    </div>
  );
}
