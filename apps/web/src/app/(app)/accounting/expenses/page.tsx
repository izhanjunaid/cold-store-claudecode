'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';

import { formatDate } from '@/lib/format';
interface ExpenseVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  amount_pkr: number;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
}

const columns: DataTableColumn<ExpenseVoucher>[] = [
  { id: 'voucher_number', header: 'Voucher #', enableHiding: false, cell: (v) => <span className="font-mono text-primary-700">{v.voucher_number}</span>, csv: (v) => v.voucher_number },
  { id: 'date', header: 'Date', cell: (v) => formatDate(v.voucher_date), csv: (v) => v.voucher_date },
  { id: 'account', header: 'Account', cell: (v) => <span className="font-mono">{v.expense_account_code}</span>, csv: (v) => v.expense_account_code },
  { id: 'description', header: 'Description', cell: (v) => v.description, csv: (v) => v.description },
  { id: 'vendor', header: 'Vendor', cell: (v) => v.vendor_name ?? '—', csv: (v) => v.vendor_name ?? '' },
  { id: 'amount', header: 'Amount', numeric: true, cell: (v) => <span className="font-medium">{v.amount_pkr.toLocaleString()}</span>, csv: (v) => v.amount_pkr },
  { id: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} />, csv: (v) => v.status },
];

const FILTER_KEYS = ['status', 'date_from', 'date_to'] as const;

export default function ExpenseVouchersPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'expenses.record');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<ExpenseVoucher>(
    qk.accounting.list('expense-vouchers', params),
    '/v1/expense-vouchers',
    params,
    { enabled: canAccess },
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Expense Vouchers" />
        <p className="text-muted-foreground">You don&apos;t have permission to view expenses.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Expense Vouchers"
        description="Operating expenses — record, approve, accrue and pay"
        actions={
          <Button asChild>
            <Link href="/accounting/expenses/new">
              <Plus className="h-4 w-4" aria-hidden />
              New Voucher
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
        getRowId={(v) => v.id}
        onRowClick={(v) => router.push(`/accounting/expenses/${v.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [{ key: 'status', label: 'Status', options: ['DRAFT', 'APPROVED', 'ACCRUED', 'PAID', 'CANCELLED'].map((v) => ({ label: v[0] + v.slice(1).toLowerCase(), value: v })) }],
          extra: (
            <div className="flex items-center gap-2">
              <Input type="date" aria-label="From date" value={state.filters['date_from'] ?? ''} onChange={(e) => setFilter('date_from', e.target.value)} className="h-8 w-auto tabular-nums" />
              <span className="text-muted-foreground">–</span>
              <Input type="date" aria-label="To date" value={state.filters['date_to'] ?? ''} onChange={(e) => setFilter('date_to', e.target.value)} className="h-8 w-auto tabular-nums" />
            </div>
          ),
        }}
        csvFilename="expense-vouchers"
        emptyState={{ title: 'No vouchers yet' }}
      />
    </div>
  );
}
