'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useAccounts, isExpenseAccount } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { ExpenseVoucherForm } from './expense-voucher-form';
import { ExpenseVoucherEditDialog, ExpenseVoucherPayDialog } from './expense-voucher-dialogs';
import { ExpenseVoucherRowActions } from './expense-voucher-row-actions';

import { formatDate } from '@/lib/format';
interface ExpenseVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  reference_number: string | null;
  amount_pkr: number;
  is_accrual: boolean;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
}

const FILTER_KEYS = ['status', 'expense_account_code', 'date_from', 'date_to'] as const;

export default function ExpenseVouchersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'expenses.record');
  const canCreate = can(user, 'expenses.record');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Row actions (Approve/Accrue/Cancel fire directly; Edit/Pay open these) —
  // most voucher work now happens without ever leaving this list. The
  // detail page (JE links, a bookmarkable URL) is still there as a fallback,
  // not the primary way to act on a voucher.
  const [editTarget, setEditTarget] = useState<ExpenseVoucher | null>(null);
  const [payTarget, setPayTarget] = useState<ExpenseVoucher | null>(null);

  const { data: accounts = [] } = useAccounts();
  const expenseAccounts = accounts.filter(isExpenseAccount);

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);

  const { data, isLoading, isError } = useListQuery<ExpenseVoucher>(
    qk.accounting.list('expense-vouchers', params),
    '/v1/expense-vouchers',
    params,
    { enabled: canAccess },
  );

  const refreshList = () => queryClient.invalidateQueries({ queryKey: qk.accounting.all });

  // Inline (not module-level, unlike every sibling list) — the actions
  // column needs to open this page's Edit/Pay dialogs and trigger a refetch,
  // which only exist once the page has rendered.
  const columns: DataTableColumn<ExpenseVoucher>[] = [
    { id: 'voucher_number', header: 'Voucher #', enableHiding: false, cell: (v) => <span className="font-mono text-primary-700">{v.voucher_number}</span>, csv: (v) => v.voucher_number },
    { id: 'date', header: 'Date', cell: (v) => formatDate(v.voucher_date), csv: (v) => v.voucher_date },
    { id: 'account', header: 'Account', cell: (v) => <span className="font-mono">{v.expense_account_code}</span>, csv: (v) => v.expense_account_code },
    { id: 'description', header: 'Description', cell: (v) => v.description, csv: (v) => v.description },
    { id: 'vendor', header: 'Vendor', cell: (v) => v.vendor_name ?? '—', csv: (v) => v.vendor_name ?? '' },
    { id: 'amount', header: 'Amount', numeric: true, cell: (v) => <span className="font-medium">{v.amount_pkr.toLocaleString()}</span>, csv: (v) => v.amount_pkr },
    { id: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} />, csv: (v) => v.status },
    {
      id: 'actions', header: '', enableHiding: false,
      cell: (v) => (
        <ExpenseVoucherRowActions
          voucher={v}
          onEdit={() => setEditTarget(v)}
          onPay={() => setPayTarget(v)}
          onChanged={refreshList}
        />
      ),
    },
  ];

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
          canCreate && (
            <Button onClick={() => setDrawerOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New Voucher
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
        getRowId={(v) => v.id}
        onRowClick={(v) => router.push(`/accounting/expenses/${v.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            { key: 'status', label: 'Status', options: ['DRAFT', 'APPROVED', 'ACCRUED', 'PAID', 'CANCELLED'].map((v) => ({ label: v[0] + v.slice(1).toLowerCase(), value: v })) },
            { key: 'expense_account_code', label: 'Account', options: expenseAccounts.map((a) => ({ label: `${a.account_code} — ${a.account_name}`, value: a.account_code })) },
          ],
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

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent size="md">
          <SheetHeader>
            <SheetTitle>New Expense Voucher</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {drawerOpen && (
              <ExpenseVoucherForm
                onCreated={() => {
                  setDrawerOpen(false);
                  refreshList();
                }}
                onCancel={() => setDrawerOpen(false)}
              />
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <ExpenseVoucherEditDialog
        voucher={editTarget}
        open={editTarget !== null}
        onOpenChange={(o) => !o && setEditTarget(null)}
        onSaved={refreshList}
      />
      <ExpenseVoucherPayDialog
        voucher={payTarget}
        open={payTarget !== null}
        onOpenChange={(o) => !o && setPayTarget(null)}
        onPaid={refreshList}
      />
    </div>
  );
}
