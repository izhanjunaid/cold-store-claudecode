'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, HandCoins, Landmark, Plus, Timer } from 'lucide-react';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { ConvertVoucherDialog, cancelVoucher, type LegacyVoucher } from './convert-voucher-dialog';

const FILTER_KEYS = ['status', 'date_from', 'date_to'] as const;

const LINKS = [
  { href: '/accounting/payables/bills', icon: FileText, title: 'Bills', text: 'What suppliers billed — each a cost at its own date.' },
  { href: '/accounting/payables/payments', icon: HandCoins, title: 'Supplier payments', text: 'Paying suppliers, with the tax withheld.' },
  { href: '/accounting/payables/aging', icon: Timer, title: 'Payables aging', text: 'What is owed to whom, and how overdue.' },
  { href: '/accounting/payables/tax-remittances', icon: Landmark, title: 'Tax & EOBI remittances', text: 'Paying over what was collected for the state.' },
];

/**
 * Costs are recorded as supplier bills (docs/25 Q3). Expense vouchers are retired: the
 * ones a facility already has stay listed here, and what can still happen to each —
 * cancel, or convert an accrued one to a bill — comes from the API (C-11).
 */
export default function ExpensesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const canRecord = useCan('expenses.record');
  const canApprove = useCan('expenses.approve');
  const [convertTarget, setConvertTarget] = useState<LegacyVoucher | null>(null);

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);
  const { data, isLoading, isError } = useListQuery<LegacyVoucher>(
    qk.accounting.list('expense-vouchers', params),
    '/v1/expense-vouchers',
    params,
    { enabled: canRecord },
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.accounting.all });

  const columns: DataTableColumn<LegacyVoucher>[] = [
    { id: 'voucher_number', header: 'Voucher #', enableHiding: false, cell: (v) => <span className="font-mono">{v.voucher_number}</span>, csv: (v) => v.voucher_number },
    { id: 'date', header: 'Date', cell: (v) => formatDate(v.voucher_date), csv: (v) => v.voucher_date },
    { id: 'description', header: 'Description', cell: (v) => v.description, csv: (v) => v.description },
    { id: 'vendor', header: 'Vendor', cell: (v) => v.vendor_name ?? '—', csv: (v) => v.vendor_name ?? '' },
    { id: 'amount', header: 'Amount', numeric: true, cell: (v) => formatMoney(v.amount_pkr), csv: (v) => v.amount_pkr },
    { id: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} />, csv: (v) => v.status },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: (v) =>
        canApprove ? (
          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {v.allowed_actions.includes('convert_to_bill') && (
              <Button size="sm" variant="outline" onClick={() => setConvertTarget(v)}>Convert to bill</Button>
            )}
            {v.allowed_actions.includes('cancel') && (
              <Button size="sm" variant="outline" onClick={() => cancelVoucher(v, refresh)}>Cancel</Button>
            )}
          </div>
        ) : null,
    },
  ];

  if (!canRecord) {
    return (
      <div>
        <PageHeader title="Expenses & Payables" />
        <p className="text-muted-foreground">You don&apos;t have permission to view expenses.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Expenses & Payables"
        description="Costs are recorded as supplier bills and paid through supplier payments"
        actions={
          <Button asChild>
            <Link href="/accounting/payables/bills/new">
              <Plus className="h-4 w-4" aria-hidden />
              New bill
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="h-full p-3 transition-colors hover:bg-muted/50">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <l.icon className="h-4 w-4" aria-hidden />
                {l.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{l.text}</p>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="text-sm font-semibold">Expense vouchers (before payables)</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        Vouchers are no longer created. An accrued one is converted to a bill so it can be paid; one that posted
        nothing can be cancelled.
      </p>
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
            {
              key: 'status',
              label: 'Status',
              options: ['DRAFT', 'APPROVED', 'ACCRUED', 'PAID', 'CANCELLED', 'CONVERTED'].map((v) => ({ label: v[0] + v.slice(1).toLowerCase(), value: v })),
            },
          ],
        }}
        csvFilename="expense-vouchers"
        emptyState={{ title: 'No expense vouchers' }}
      />

      <ConvertVoucherDialog
        voucher={convertTarget}
        onOpenChange={(o) => !o && setConvertTarget(null)}
        onConverted={(billId) => router.push(`/accounting/payables/bills/${billId}`)}
      />
    </div>
  );
}
