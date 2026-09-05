'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { StatTile } from '@/components/stat-tile';
import { PaymentClearDialog, PaymentDishonourDialog } from '../payment-dialogs';
import { ApplyAdvanceForm } from '../apply-advance-form';

import { formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface PaymentAllocation {
  id: string;
  invoice_id: string;
  invoice_number: string | null;
  allocated_amount_pkr: number;
}
interface Payment {
  id: string;
  party_id: string;
  party_name: string;
  payment_date: string;
  receipt_number: string | null;
  tax_withheld_pkr: number;
  cash_received_pkr: number;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' | 'DISHONOURED';
  clearance_status: string;
  cheque_date: string | null;
  book_type: string;
  notes: string | null;
  created_by_name: string;
  allocations: PaymentAllocation[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_WALLET: 'Mobile Wallet',
};

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

export default function PaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const id = params['id'] as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);

  const [showClear, setShowClear] = useState(false);
  const [showDishonour, setShowDishonour] = useState(false);

  const isAccountant = can(user, 'payments.record');
  const canApplyAdvance = isAccountant && payment?.status === 'ADVANCE';

  useEffect(() => {
    apiClient<Payment>(`/v1/payments/${id}`)
      .then(setPayment)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PageSkeleton />;
  if (!payment) return <p className="text-destructive">Payment not found</p>;

  const totalAllocated = payment.allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
  const unallocated = payment.amount_pkr - totalAllocated;
  const canClear = isAccountant && payment.payment_method === 'CHEQUE' && payment.clearance_status === 'PENDING';
  const canDishonour = isAccountant && payment.status !== 'DISHONOURED' && payment.payment_method === 'CHEQUE';

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={payment.receipt_number ?? 'Payment Detail'}
        description={payment.receipt_number ? 'Payment receipt' : undefined}
        crumb="Detail"
        actions={
          <>
            {canClear && (
              <Button variant="outline" onClick={() => setShowClear(true)}>
                Mark Cleared
              </Button>
            )}
            {canDishonour && (
              <Button variant="outline" className="text-destructive" onClick={() => setShowDishonour(true)}>
                Mark Dishonoured
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <StatusBadge status={payment.status} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile size="compact" label="Payment Amount" value={formatMoney(payment.amount_pkr)} />
        <StatTile size="compact" label="Allocated" value={formatMoney(totalAllocated)} tone={totalAllocated > 0 ? 'positive' : 'default'} />
        {unallocated > 0.001 && (
          <StatTile size="compact" label="Unallocated" value={formatMoney(unallocated)} tone="warning" />
        )}
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-4 pt-4 text-sm">
          <Info
            label="Party"
            value={
              <Button variant="link" className="h-auto p-0" onClick={() => router.push(`/parties/${payment.party_id}`)}>
                {payment.party_name}
              </Button>
            }
          />
          <Info label="Receipt No." value={payment.receipt_number ?? '—'} />
          {payment.tax_withheld_pkr > 0 && (
            <>
              <Info label="Tax Withheld (s.153)" value={formatMoney(payment.tax_withheld_pkr)} />
              <Info label="Cash Received" value={formatMoney(payment.cash_received_pkr)} />
            </>
          )}
          <Info label="Payment Date" value={payment.payment_date} />
          <Info label="Method" value={METHOD_LABELS[payment.payment_method] ?? payment.payment_method} />
          <Info label="Reference" value={payment.reference_number ?? '—'} />
          {payment.cheque_date && <Info label="Cheque Date" value={payment.cheque_date} />}
          <Info label="Clearance" value={payment.clearance_status} />
          <Info label="Book Type" value={payment.book_type} />
          <Info label="Recorded By" value={payment.created_by_name} />
          {payment.notes && (
            <div className="col-span-2">
              <Info label="Notes" value={payment.notes} />
            </div>
          )}
        </CardContent>
      </Card>

      {payment.allocations.length > 0 && (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-sm">Invoice Allocations</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Allocated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payment.allocations.map((alloc) => (
                  <TableRow key={alloc.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${alloc.invoice_id}`)}>
                    <TableCell className="font-mono text-primary-700">{alloc.invoice_number ?? alloc.invoice_id.slice(0, 8)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{alloc.allocated_amount_pkr.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {canApplyAdvance && (
        <Card className="mb-4 border-l-4 border-l-primary/40">
          <CardHeader>
            <CardTitle className="text-sm">Apply Advance</CardTitle>
          </CardHeader>
          <CardContent>
            <ApplyAdvanceForm<Payment>
              paymentId={payment.id}
              partyId={payment.party_id}
              amountPkr={payment.amount_pkr}
              onDone={setPayment}
            />
          </CardContent>
        </Card>
      )}

      <PaymentClearDialog<Payment>
        paymentId={payment.id}
        open={showClear}
        onOpenChange={setShowClear}
        onDone={setPayment}
      />

      <PaymentDishonourDialog<Payment>
        paymentId={payment.id}
        open={showDishonour}
        onOpenChange={setShowDishonour}
        onDone={setPayment}
      />

    </div>
  );
}
