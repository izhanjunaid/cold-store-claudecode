'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { paymentColumns, type PaymentRow } from './columns';

const FILTER_KEYS = ['status', 'payment_method', 'date_from', 'date_to'] as const;

export default function PaymentListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'billing.view');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);

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

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Payments" />
        <p className="text-muted-foreground">You don&apos;t have permission to view payments.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payments"
        description="Cash, cheque and transfer receipts with invoice allocations"
        actions={
          <Button asChild>
            <Link href="/payments/new">
              <Plus className="h-4 w-4" aria-hidden />
              Record Payment
            </Link>
          </Button>
        }
      />

      <DataTable
        columns={paymentColumns}
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
        }}
        csvFilename="payments"
        emptyState={{
          title: 'No payments found',
          description: 'Record a payment to allocate it against outstanding invoices.',
          action: (
            <Button asChild size="sm">
              <Link href="/payments/new">
                <Plus className="h-4 w-4" aria-hidden />
                Record Payment
              </Link>
            </Button>
          ),
        }}
      />
    </div>
  );
}
