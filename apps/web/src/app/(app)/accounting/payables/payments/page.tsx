'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { round2 } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { useOpenBills, useSuppliers, type SupplierPayment } from '../payables-shared';
import { SupplierPaymentDialog } from '../supplier-payment-dialog';
import { VoidDocumentDialog } from '../void-document-dialog';

const FILTER_KEYS = ['supplier_party_id', 'date_from', 'date_to'] as const;

export default function SupplierPaymentsPage() {
  const queryClient = useQueryClient();
  const canRecord = useCan('expenses.record');
  const canApprove = useCan('expenses.approve');
  const { data: suppliers = [] } = useSuppliers();
  const [creating, setCreating] = useState(false);
  const [voidTarget, setVoidTarget] = useState<SupplierPayment | null>(null);
  const [allocTarget, setAllocTarget] = useState<SupplierPayment | null>(null);

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage, ...state.filters }), [state]);
  const { data, isLoading, isError } = useListQuery<SupplierPayment>(
    qk.accounting.list('supplier-payments', params),
    '/v1/supplier-payments',
    params,
    { enabled: canRecord },
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounting'] });

  const columns: DataTableColumn<SupplierPayment>[] = [
    { id: 'number', header: 'Payment #', enableHiding: false, cell: (p) => <span className="font-mono">{p.payment_number}</span>, csv: (p) => p.payment_number ?? '' },
    { id: 'date', header: 'Date', cell: (p) => formatDate(p.payment_date), csv: (p) => p.payment_date },
    { id: 'supplier', header: 'Supplier', cell: (p) => p.supplier_name, csv: (p) => p.supplier_name },
    { id: 'from', header: 'Paid from', cell: (p) => p.asset_account_name, csv: (p) => p.asset_account_name },
    { id: 'gross', header: 'Settled', numeric: true, cell: (p) => formatMoney(p.gross_amount_pkr), csv: (p) => p.gross_amount_pkr },
    {
      id: 'wht',
      header: 'Tax withheld',
      numeric: true,
      cell: (p) => (p.withholding_pkr ? `${formatMoney(p.withholding_pkr)} (${p.withholding_rate_pct}%)` : '—'),
      csv: (p) => p.withholding_pkr,
    },
    { id: 'net', header: 'Paid', numeric: true, cell: (p) => formatMoney(p.net_paid_pkr), csv: (p) => p.net_paid_pkr },
    { id: 'unapplied', header: 'On account', numeric: true, cell: (p) => (p.unapplied_pkr ? formatMoney(p.unapplied_pkr) : '—'), csv: (p) => p.unapplied_pkr },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => <StatusBadge status={p.voided_at ? 'VOID' : 'POSTED'} />,
      csv: (p) => (p.voided_at ? `VOID: ${p.void_reason ?? ''}` : 'POSTED'),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: (p) => (
        <div className="flex justify-end gap-1">
          {p.allowed_actions.includes('allocate') && canRecord && (
            <Button size="sm" variant="outline" onClick={() => setAllocTarget(p)}>Apply to bills</Button>
          )}
          {p.allowed_actions.includes('void') && canApprove && (
            <Button size="sm" variant="outline" onClick={() => setVoidTarget(p)}>Void</Button>
          )}
        </div>
      ),
    },
  ];

  if (!canRecord) {
    return (
      <div>
        <PageHeader title="Supplier payments" />
        <p className="text-muted-foreground">You don&apos;t have permission to view supplier payments.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Supplier payments"
        description="Money paid to suppliers, the tax withheld from it, and the bills it settled"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/accounting/payables/bills">Bills</Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Pay supplier
            </Button>
          </div>
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
        getRowId={(p) => p.id}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{ facets: [{ key: 'supplier_party_id', label: 'Supplier', options: suppliers.map((s) => ({ label: s.name, value: s.id })) }] }}
        csvFilename="supplier-payments"
        emptyState={{ title: 'No supplier payments yet' }}
      />

      <SupplierPaymentDialog open={creating} onOpenChange={setCreating} onPaid={refresh} />
      <AllocateDialog payment={allocTarget} onOpenChange={(o) => !o && setAllocTarget(null)} onDone={refresh} />
      <VoidDocumentDialog
        title="Void payment"
        explanation="For a payment recorded in error: its entry is reversed and every bill it paid is owed again."
        url={voidTarget ? `/v1/supplier-payments/${voidTarget.id}/void` : null}
        open={voidTarget !== null}
        onOpenChange={(o) => !o && setVoidTarget(null)}
        onVoided={refresh}
      />
    </div>
  );
}

/** Apply what a payment left on account to the supplier's open bills. */
function AllocateDialog({
  payment,
  onOpenChange,
  onDone,
}: {
  payment: SupplierPayment | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { data: bills = [] } = useOpenBills(payment?.supplier_party_id ?? null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const total = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));

  const submit = async () => {
    if (!payment) return;
    setBusy(true);
    try {
      await apiClient(`/v1/supplier-payments/${payment.id}/allocate`, {
        method: 'POST',
        body: {
          allocations: Object.entries(alloc)
            .filter(([, v]) => Number(v) > 0)
            .map(([bill_id, v]) => ({ bill_id, amount_pkr: Number(v) })),
        },
      });
      toast.success('Applied to bills');
      setAlloc({});
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply the payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply {payment?.payment_number} to bills</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{payment && `${formatMoney(payment.unapplied_pkr)} is on account.`}</p>
        {bills.length === 0 && <p className="text-xs text-muted-foreground">This supplier has no open bills.</p>}
        {bills.map((b) => (
          <div key={b.id} className="grid grid-cols-[1fr_auto_8rem] items-center gap-2 text-sm">
            <span>
              <span className="font-mono">{b.bill_number}</span> · {formatDate(b.bill_date)}
            </span>
            <span className="tabular-nums text-muted-foreground">{formatMoney(b.open_pkr)} open</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              aria-label={`Apply to ${b.bill_number}`}
              value={alloc[b.id] ?? ''}
              onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })}
            />
          </div>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || total <= 0 || (payment !== null && total > payment.unapplied_pkr + 0.001)} onClick={submit}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
