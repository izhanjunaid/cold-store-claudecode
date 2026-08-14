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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
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
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Invoice date</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Months</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Suggested</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data?.suggestions.length ? (
                data.suggestions.map((s) => (
                  <TableRow key={s.invoice_id}>
                    <TableCell>
                      <button
                        onClick={() => router.push(`/invoices/${s.invoice_id}`)}
                        className="font-mono text-primary hover:underline"
                      >
                        {s.invoice_number ?? s.invoice_id.slice(0, 8)}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">{s.billing_party_name}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {s.invoice_date}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">
                      {s.days_overdue}d
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.chargeable_months}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtPkr(s.base_outstanding_pkr)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {fmtPkr(s.suggested_amount_pkr)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canApply && (
                        <Button
                          size="sm"
                          onClick={() => handleApply(s)}
                          disabled={applyMutation.isPending}
                        >
                          {applyingId === s.invoice_id ? 'Applying…' : 'Apply'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                    No overdue invoices are eligible for a surcharge.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
