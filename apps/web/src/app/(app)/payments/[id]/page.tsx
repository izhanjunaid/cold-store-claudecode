'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';

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
  const confirm = useConfirm();
  const { user } = useAuthStore();
  const id = params['id'] as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [dishonourNotes, setDishonourNotes] = useState('');
  const [showDishonourForm, setShowDishonourForm] = useState(false);
  const [dishonourSubmitting, setDishonourSubmitting] = useState(false);

  const isAccountant = !!user && hasMinRole(user.role, 'ACCOUNTANT');

  useEffect(() => {
    apiClient<Payment>(`/v1/payments/${id}`)
      .then(setPayment)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleDishonour = async () => {
    const ok = await confirm({
      title: 'Dishonour this cheque?',
      description: 'All allocations will be reversed and invoice balances restored.',
      confirmText: 'Confirm Dishonour',
      destructive: true,
    });
    if (!ok) return;
    setDishonourSubmitting(true);
    try {
      const updated = await apiClient<Payment>(`/v1/payments/${id}/dishonour`, {
        method: 'POST',
        body: { notes: dishonourNotes || undefined },
      });
      setPayment(updated);
      setShowDishonourForm(false);
      toast.success('Cheque dishonoured');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dishonour payment');
    } finally {
      setDishonourSubmitting(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!payment) return <p className="text-destructive">Payment not found</p>;

  const totalAllocated = payment.allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
  const unallocated = payment.amount_pkr - totalAllocated;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Payment Detail" crumb="Detail" />

      <div className="mb-4">
        <StatusBadge status={payment.status} />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-6 pt-6">
          <Info
            label="Party"
            value={
              <Button variant="link" className="h-auto p-0" onClick={() => router.push(`/parties/${payment.party_id}`)}>
                {payment.party_name}
              </Button>
            }
          />
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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-sm">Amount Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Payment Amount</span>
            <span className="font-semibold tabular-nums">PKR {payment.amount_pkr.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Allocated</span>
            <span className="tabular-nums text-green-700">PKR {totalAllocated.toLocaleString()}</span>
          </div>
          {unallocated > 0.001 && (
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Unallocated</span>
              <span className="font-medium tabular-nums text-amber-600">PKR {unallocated.toLocaleString()}</span>
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

      {isAccountant && payment.status !== 'DISHONOURED' && payment.payment_method === 'CHEQUE' && (
        <Card className="border-l-4 border-l-amber-400">
          <CardHeader>
            <CardTitle className="text-sm">Cheque Dishonour</CardTitle>
          </CardHeader>
          <CardContent>
            {!showDishonourForm ? (
              <Button variant="outline" className="text-destructive" onClick={() => setShowDishonourForm(true)}>
                Mark Cheque as Dishonoured
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  All allocations will be reversed and invoice balances restored.
                </p>
                <Textarea
                  value={dishonourNotes}
                  onChange={(e) => setDishonourNotes(e.target.value)}
                  rows={2}
                  placeholder="Reason for dishonour (optional)"
                />
                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setShowDishonourForm(false)}>
                    Cancel
                  </Button>
                  <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDishonour} disabled={dishonourSubmitting}>
                    {dishonourSubmitting ? 'Processing…' : 'Confirm Dishonour'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
