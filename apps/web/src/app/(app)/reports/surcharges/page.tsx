'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { SurchargeSuggestionsResponseType, SurchargeSuggestionType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { formatCount } from '@/lib/format';

const fmtPkr = formatCount;

/**
 * Late-payment surcharge worklist.
 *
 * Suggestions only — nothing is ever charged automatically, which is the whole design:
 * a surcharge on a mandi customer is a relationship decision, not an arithmetic one.
 * Applying posts JE-21 to the invoice and the GL.
 *
 * Two permissions, deliberately different: `reports.financial` to see the list (the
 * suggestions endpoint), `invoices.manage` to actually charge one. An accountant can
 * review and hand the decision up without being able to make it.
 */
export default function SurchargesReportPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const queryClient = useQueryClient();
  const canView = can(user, 'reports.financial');
  const canApply = can(user, 'invoices.manage');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<SurchargeSuggestionsResponseType>({
    queryKey: ['surcharge-suggestions', user?.facility_id],
    queryFn: () => apiClient<SurchargeSuggestionsResponseType>('/v1/surcharges/suggestions'),
    enabled: canView && !!user,
  });

  const applyMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      apiClient(`/v1/invoices/${invoiceId}/surcharges`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('Surcharge applied and posted to the ledger.');
      queryClient.invalidateQueries({ queryKey: ['surcharge-suggestions'] });
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Failed to apply surcharge');
    },
    onSettled: () => setApplyingId(null),
  });

  function handleApply(s: SurchargeSuggestionType) {
    setApplyingId(s.invoice_id);
    applyMutation.mutate(s.invoice_id);
  }

  const columns: DataTableColumn<SurchargeSuggestionType>[] = [
      {
        id: 'invoice', header: 'Invoice', enableHiding: false,
        cell: (s) => <span className="font-mono text-primary-700">{s.invoice_number ?? s.invoice_id.slice(0, 8)}</span>,
        csv: (s) => s.invoice_number ?? s.invoice_id,
      },
      { id: 'party', header: 'Party', cell: (s) => <span className="font-medium">{s.billing_party_name}</span>, csv: (s) => s.billing_party_name },
      { id: 'invoice_date', header: 'Invoice date', cell: (s) => s.invoice_date, csv: (s) => s.invoice_date },
      {
        id: 'overdue', header: 'Overdue', numeric: true,
        cell: (s) => <span className="text-destructive">{s.days_overdue}d</span>,
        csv: (s) => s.days_overdue,
      },
      { id: 'months', header: 'Months', numeric: true, cell: (s) => s.chargeable_months, csv: (s) => s.chargeable_months },
      { id: 'outstanding', header: 'Outstanding', numeric: true, cell: (s) => fmtPkr(s.base_outstanding_pkr), csv: (s) => s.base_outstanding_pkr },
      {
        id: 'suggested', header: 'Suggested', numeric: true,
        cell: (s) => <span className="font-semibold">{fmtPkr(s.suggested_amount_pkr)}</span>,
        csv: (s) => s.suggested_amount_pkr,
        footer: (rows) => `${fmtPkr(rows.reduce((sum, r) => sum + r.suggested_amount_pkr, 0))} PKR`,
      },
      ...(canApply
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: (s: SurchargeSuggestionType) => (
                <div onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" onClick={() => handleApply(s)} disabled={applyMutation.isPending}>
                    {applyingId === s.invoice_id ? 'Applying…' : 'Apply'}
                  </Button>
                </div>
              ),
            },
          ]
        : []),
  ];

  if (!canView) {
    return (
      <div>
        <PageHeader title="Late Payment Surcharges" />
        <p className="text-muted-foreground">
          Late payment surcharges require ACCOUNTANT role or higher.
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Late Payment Surcharges"
        description="Overdue invoices eligible for a surcharge — reviewed and applied one at a time"
        actions={
          data?.enabled ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {data.pct_per_month}% / month after {data.grace_days} days grace
            </span>
          ) : null
        }
      />

      <p className="mb-4 text-sm text-muted-foreground">
        Nothing is charged automatically. The base is the unpaid principal — payments settle
        principal first, so surcharges never compound.
      </p>

      {data && !data.enabled ? (
        <Card className="p-8 text-center">
          <p className="mb-2 font-medium">The late payment surcharge rule is switched off.</p>
          {can(user, 'settings.manage') ? (
            <Button variant="link" onClick={() => router.push('/settings')}>
              Turn it on in Settings →
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask the owner to switch it on in Settings.
            </p>
          )}
        </Card>
      ) : (
        <DataTable
          columns={columns}
          data={data?.suggestions ?? []}
          meta={undefined}
          isLoading={isLoading}
          sort={null}
          onSortChange={() => {}}
          page={1}
          perPage={500}
          onPageChange={() => {}}
          onPerPageChange={() => {}}
          getRowId={(s) => s.invoice_id}
          onRowClick={(s) => router.push(`/invoices/${s.invoice_id}`)}
          emptyState={{ title: 'No overdue invoices are eligible for a surcharge.' }}
        />
      )}
    </div>
  );
}
