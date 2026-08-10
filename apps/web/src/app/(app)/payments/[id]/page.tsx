'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';

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

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  balance_due_pkr: number;
}
interface AllocationRow {
  invoice_id: string;
  allocated_amount_pkr: string;
}

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
  const [dishonourDate, setDishonourDate] = useState(new Date().toISOString().slice(0, 10));
  const [showDishonourForm, setShowDishonourForm] = useState(false);
  const [dishonourSubmitting, setDishonourSubmitting] = useState(false);
  const [clearDate, setClearDate] = useState(new Date().toISOString().slice(0, 10));
  const [clearSubmitting, setClearSubmitting] = useState(false);

  const isAccountant = can(user, 'payments.record');

  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);

  const canApplyAdvance = isAccountant && payment?.status === 'ADVANCE';

  useEffect(() => {
    apiClient<Payment>(`/v1/payments/${id}`)
      .then(setPayment)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  // An advance can only be applied while status is ADVANCE — the one envelope
  // in which the backend posts JE-04 (DR 2010 / CR receivable). Once applied,
  // status flips to ALLOCATED and this panel disappears.
  useEffect(() => {
    if (!canApplyAdvance || !payment) return;
    apiClientList<InvoiceSummary>(
      `/v1/invoices?party_id=${payment.party_id}&status=FINALIZED&page_size=100`,
    )
      .then((res) => {
        const open = res.data.filter((i) => i.balance_due_pkr > 0);
        setInvoices(open);
        setRows(open.length > 0 ? [{ invoice_id: '', allocated_amount_pkr: '' }] : []);
      })
      .catch(() => {});
  }, [canApplyAdvance, payment]);

  const totalToApply = rows.reduce((s, r) => s + (parseFloat(r.allocated_amount_pkr) || 0), 0);

  const updateRow = (idx: number, field: keyof AllocationRow, value: string) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));

  const fillBalance = (idx: number) => {
    const inv = invoices.find((i) => i.id === rows[idx]?.invoice_id);
    if (inv) updateRow(idx, 'allocated_amount_pkr', String(inv.balance_due_pkr));
  };

  const handleApplyAdvance = async () => {
    if (applyingRef.current || !payment) return;
    const valid = rows
      .filter((r) => r.invoice_id && parseFloat(r.allocated_amount_pkr) > 0)
      .map((r) => ({ invoice_id: r.invoice_id, allocated_amount_pkr: parseFloat(r.allocated_amount_pkr) }));
    if (valid.length === 0) {
      setApplyError('Select an invoice and enter an amount to apply.');
      return;
    }
    if (totalToApply > payment.amount_pkr + 0.001) {
      setApplyError('Total to apply exceeds the advance amount.');
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setApplyError('');
    try {
      const updated = await apiClient<Payment>(`/v1/payments/${id}/allocate`, {
        method: 'POST',
        body: { allocations: valid },
      });
      setPayment(updated);
      toast.success('Advance applied');
      // Stay disabled through the re-render — the panel unmounts once status
      // is no longer ADVANCE, so we intentionally don't reset the guard here.
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'Failed to apply advance');
      applyingRef.current = false;
      setApplying(false);
    }
  };

  const handleClear = async () => {
    setClearSubmitting(true);
    try {
      const updated = await apiClient<Payment>(`/v1/payments/${id}/clear`, {
        method: 'POST',
        body: { clear_date: clearDate },
      });
      setPayment(updated);
      toast.success('Cheque marked cleared');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear payment');
    } finally {
      setClearSubmitting(false);
    }
  };

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
        body: { notes: dishonourNotes || undefined, dishonour_date: dishonourDate },
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

  if (loading) return <PageSkeleton />;
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
            <span className="font-semibold tabular-nums">{formatMoney(payment.amount_pkr)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Allocated</span>
            <span className="tabular-nums text-green-700">{formatMoney(totalAllocated)}</span>
          </div>
          {unallocated > 0.001 && (
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Unallocated</span>
              <span className="font-medium tabular-nums text-amber-600">{formatMoney(unallocated)}</span>
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
            {invoices.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                No finalized invoices with outstanding balance for this party.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Applying drains the advance liability (2010) and settles the invoice (JE-04). This can only be done once.
                </p>
                {applyError && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {applyError}
                  </div>
                )}
                {rows.map((row, idx) => (
                  <div key={idx} className="flex items-end gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Invoice</Label>
                      <select
                        value={row.invoice_id}
                        onChange={(e) => updateRow(idx, 'invoice_id', e.target.value)}
                        className={SELECT_CLASS}
                      >
                        <option value="">Select invoice…</option>
                        {invoices.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.invoice_number ?? inv.id.slice(0, 8)} — Balance: {formatMoney(inv.balance_due_pkr)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="w-40 space-y-1.5">
                      <Label className="text-xs">Amount (PKR)</Label>
                      <Input
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={row.allocated_amount_pkr}
                        onChange={(e) => updateRow(idx, 'allocated_amount_pkr', e.target.value)}
                        placeholder="0.00"
                        className="tabular-nums"
                      />
                    </div>
                    {row.invoice_id && (
                      <Button type="button" variant="link" className="h-9 px-1 text-xs" onClick={() => fillBalance(idx)}>
                        Fill balance
                      </Button>
                    )}
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-destructive"
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove allocation"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRows((prev) => [...prev, { invoice_id: '', allocated_amount_pkr: '' }])}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    Add Invoice
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    To apply:{' '}
                    <span className="font-medium tabular-nums">{formatMoney(totalToApply)}</span> / PKR{' '}
                    {payment.amount_pkr.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleApplyAdvance} disabled={applying}>
                    {applying ? 'Applying…' : 'Apply Advance'}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isAccountant && payment.payment_method === 'CHEQUE' && payment.clearance_status === 'PENDING' && (
        <Card className="mb-4 border-l-4 border-l-green-500">
          <CardHeader>
            <CardTitle className="text-sm">Cheque Clearing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This cheque is parked in 1025 (Cheques in Hand) until the bank processes it. Marking it
              cleared moves the amount into Bank Account — Main.
            </p>
            <div className="flex items-end gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Cleared date</Label>
                <Input type="date" value={clearDate} onChange={(e) => setClearDate(e.target.value)} className="tabular-nums" />
              </div>
              <Button onClick={handleClear} disabled={clearSubmitting}>
                {clearSubmitting ? 'Processing…' : 'Mark Cleared'}
              </Button>
            </div>
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
                <div className="space-y-1.5">
                  <Label>Dishonour date</Label>
                  <Input type="date" value={dishonourDate} onChange={(e) => setDishonourDate(e.target.value)} className="tabular-nums" />
                </div>
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
