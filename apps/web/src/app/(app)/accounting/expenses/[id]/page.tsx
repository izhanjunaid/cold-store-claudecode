'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';
import { ConvertVoucherDialog, cancelVoucher, type LegacyVoucher } from '../convert-voucher-dialog';

/** A voucher from before payables (docs/25 C-03): read-only, with what the API still allows. */
export default function ExpenseVoucherDetailPage() {
  const id = useParams()['id'] as string;
  const router = useRouter();
  const canApprove = useCan('expenses.approve');
  const canPeekJe = useCan('accounting.view');
  const [converting, setConverting] = useState(false);

  const { data: v, refetch } = useQuery({
    queryKey: ['accounting', 'expense-voucher', id],
    queryFn: () => apiClient<LegacyVoucher>(`/v1/expense-vouchers/${id}`),
  });
  if (!v) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const entry = (label: string, entryId: string | null) =>
    entryId && (
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {canPeekJe ? (
          <Link className="text-primary-700 hover:underline" href={`/accounting/journal-entries/${entryId}`}>
            View entry
          </Link>
        ) : (
          '—'
        )}
      </div>
    );

  return (
    <div>
      <PageHeader
        title={v.voucher_number}
        description={v.description}
        actions={
          canApprove && (
            <div className="flex gap-2">
              {v.allowed_actions.includes('convert_to_bill') && <Button onClick={() => setConverting(true)}>Convert to bill</Button>}
              {v.allowed_actions.includes('cancel') && (
                <Button variant="outline" onClick={() => cancelVoucher(v, () => void refetch())}>Cancel voucher</Button>
              )}
            </div>
          )
        }
      />
      <Card>
        <CardContent className="grid gap-4 pt-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <StatusBadge status={v.status} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Date</div>
            {formatDate(v.voucher_date)}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Amount</div>
            <span className="tabular-nums">{formatMoney(v.amount_pkr)}</span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Vendor</div>
            {v.vendor_name ?? '—'}
          </div>
          {entry('Accrual entry', v.accrual_journal_entry_id)}
          {entry('Payment entry', v.payment_journal_entry_id)}
          {v.bill_id && (
            <div>
              <div className="text-xs text-muted-foreground">Converted to</div>
              <Link className="text-primary-700 hover:underline" href={`/accounting/payables/bills/${v.bill_id}`}>
                Bill
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">
        Expense vouchers are retired; costs are recorded as supplier bills.
      </p>

      <ConvertVoucherDialog
        voucher={converting ? v : null}
        onOpenChange={setConverting}
        onConverted={(billId) => router.push(`/accounting/payables/bills/${billId}`)}
      />
    </div>
  );
}
