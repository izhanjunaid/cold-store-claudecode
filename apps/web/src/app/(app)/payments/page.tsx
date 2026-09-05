'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { useParties } from '@/hooks/use-reference-data';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { qk } from '@/lib/query-keys';
import { getPaymentColumns, type PaymentRow } from './columns';
import { PaymentClearDialog, PaymentDishonourDialog } from './payment-dialogs';
import { ApplyAdvanceSheet } from './apply-advance-form';

const FILTER_KEYS = ['status', 'payment_method', 'date_from', 'date_to', 'party_id'] as const;

export default function PaymentListPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'billing.view');
  const canRecord = can(user, 'payments.record');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

  const [recordOpen, setRecordOpen] = useState(false);
  const [clearTarget, setClearTarget] = useState<PaymentRow | null>(null);
  const [dishonourTarget, setDishonourTarget] = useState<PaymentRow | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState<PaymentRow | null>(null);

  const params = useMemo(
    () => ({ page: state.page, page_size: state.perPage, ...state.filters }),
    [state],
  );

  const { data, isLoading, isError } = useListQuery<PaymentRow>(
    qk.payments.list(params),
    '/v1/payments',
    params,
    { enabled: canAccess },
  );

  // Clearing a cheque and applying an advance both move invoice balances, so
  // they invalidate more than the payments list.
  const refreshAfterAction = () => {
    queryClient.invalidateQueries({ queryKey: qk.payments.all });
    queryClient.invalidateQueries({ queryKey: qk.invoices.all });
  };

  const columns = useMemo(
    () =>
      getPaymentColumns({
        canRecord,
        onClear: setClearTarget,
        onDishonour: setDishonourTarget,
        onApplyAdvance: setAdvanceTarget,
      }),
    [canRecord],
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Payments" />
        <p className="text-muted-foreground">You don&apos;t have permission to view payments.</p>
      </div>
    );
  }

  // Named "New Payment", not "Record Payment": the drawer's own submit carries
  // that verb, and two buttons sharing an accessible name on one screen makes
  // getByRole ambiguous.
  const newPaymentButton = (size?: 'sm') => (
    <Button size={size} onClick={() => setRecordOpen(true)}>
      <Plus className="h-4 w-4" aria-hidden />
      New Payment
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Cash, cheque and transfer receipts with invoice allocations"
        actions={canRecord ? newPaymentButton() : undefined}
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
        onRowClick={(p) => router.push(`/payments/${p.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Recorded', value: 'RECORDED' },
                { label: 'Allocated', value: 'ALLOCATED' },
                { label: 'Advance', value: 'ADVANCE' },
                { label: 'Dishonoured', value: 'DISHONOURED' },
              ],
            },
            {
              key: 'payment_method',
              label: 'Method',
              options: [
                { label: 'Cash', value: 'CASH' },
                { label: 'Cheque', value: 'CHEQUE' },
                { label: 'Bank Transfer', value: 'BANK_TRANSFER' },
                { label: 'Mobile Wallet', value: 'MOBILE_WALLET' },
              ],
            },
          ],
          extra: (
            <div className="flex items-center gap-2">
              <Combobox
                options={partyOptions}
                value={state.filters['party_id'] ?? ''}
                onChange={(v) => setFilter('party_id', v)}
                placeholder="All parties"
                searchPlaceholder="Search parties…"
                className="h-8 w-[200px]"
              />
              <Input
                type="date"
                aria-label="From date"
                value={state.filters['date_from'] ?? ''}
                onChange={(e) => setFilter('date_from', e.target.value)}
                className="h-8 w-auto tabular-nums"
              />
              <span className="text-muted-foreground">–</span>
              <Input
                type="date"
                aria-label="To date"
                value={state.filters['date_to'] ?? ''}
                onChange={(e) => setFilter('date_to', e.target.value)}
                className="h-8 w-auto tabular-nums"
              />
            </div>
          ),
        }}
        csvFilename="payments"
        emptyState={{
          title: 'No payments found',
          description: 'Record a payment to allocate it against outstanding invoices.',
          action: canRecord ? newPaymentButton('sm') : undefined,
        }}
      />

      <RecordPaymentSheet
        open={recordOpen}
        onOpenChange={setRecordOpen}
        onSuccess={refreshAfterAction}
      />

      <PaymentClearDialog
        paymentId={clearTarget?.id ?? null}
        open={!!clearTarget}
        onOpenChange={(o) => !o && setClearTarget(null)}
        onDone={() => {
          setClearTarget(null);
          refreshAfterAction();
        }}
      />

      <PaymentDishonourDialog
        paymentId={dishonourTarget?.id ?? null}
        open={!!dishonourTarget}
        onOpenChange={(o) => !o && setDishonourTarget(null)}
        onDone={() => {
          setDishonourTarget(null);
          refreshAfterAction();
        }}
      />

      <ApplyAdvanceSheet
        open={!!advanceTarget}
        onOpenChange={(o) => !o && setAdvanceTarget(null)}
        payment={advanceTarget}
        onDone={() => {
          setAdvanceTarget(null);
          refreshAfterAction();
        }}
      />
    </div>
  );
}
