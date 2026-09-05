'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState } from '@/components/data-table';
import { useListQuery } from '@/hooks/use-list-query';
import { useParties } from '@/hooks/use-reference-data';
import { Combobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { VoidInvoiceDialog } from '@/components/billing/void-invoice-dialog';
import { qk } from '@/lib/query-keys';
import { getInvoiceColumns, type InvoiceRow } from './columns';

const FILTER_KEYS = ['status', 'date_from', 'date_to', 'party_id'] as const;

export default function InvoiceListPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canAccess = !user || can(user, 'billing.view');
  const canManage = can(user, 'invoices.manage');
  const canVoid = can(user, 'invoices.void');

  const { state, setPage, setPerPage, setSort, setFilter, resetFilters } = useTableState(FILTER_KEYS);

  // Invoice list uses page_size (not per_page) and has no server sort.
  const params = useMemo(
    () => ({ page: state.page, page_size: state.perPage, ...state.filters }),
    [state],
  );

  const { data, isLoading, isError } = useListQuery<InvoiceRow>(
    qk.invoices.list(params),
    '/v1/invoices',
    params,
    { enabled: canAccess },
  );

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

  const [payTarget, setPayTarget] = useState<InvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);

  // Inline (not module-level): the actions column needs to open this page's
  // Pay/Void dialogs, which only exist once the page has rendered.
  const columns = useMemo(
    () => getInvoiceColumns({ canManage, canVoid, onRecordPayment: setPayTarget, onVoid: setVoidTarget }),
    [canManage, canVoid],
  );

  if (!canAccess) {
    return (
      <div>
        <PageHeader title="Invoices" />
        <p className="text-muted-foreground">You don&apos;t have permission to view invoices.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Invoices" description="Storage invoices, payments and balances" />

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
        getRowId={(inv) => inv.id}
        onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
        filterValues={state.filters}
        onFilterChange={setFilter}
        onResetFilters={resetFilters}
        toolbar={{
          facets: [
            {
              key: 'status',
              label: 'Status',
              options: [
                { label: 'Draft', value: 'DRAFT' },
                { label: 'Finalized', value: 'FINALIZED' },
                { label: 'Void', value: 'VOID' },
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
        csvFilename="invoices"
        emptyState={{
          title: 'No invoices found',
          description: 'Invoices are created automatically when a withdrawal is dispatched.',
        }}
      />

      {payTarget && (
        <RecordPaymentSheet
          open={payTarget !== null}
          onOpenChange={(o) => !o && setPayTarget(null)}
          partyId={payTarget.billing_party_id}
          partyName={payTarget.billing_party_name}
          invoiceId={payTarget.id}
          invoiceNumber={payTarget.invoice_number}
          invoiceBalance={payTarget.balance_due_pkr}
          onSuccess={() => setPayTarget(null)}
        />
      )}
      {voidTarget && (
        <VoidInvoiceDialog
          open={voidTarget !== null}
          onOpenChange={(o) => !o && setVoidTarget(null)}
          invoiceId={voidTarget.id}
          invoiceNumber={voidTarget.invoice_number}
          onSuccess={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
