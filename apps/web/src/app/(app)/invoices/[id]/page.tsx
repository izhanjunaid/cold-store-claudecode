'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, FileText, Plus, Trash2 } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';
import { RecordPaymentSheet } from '@/components/billing/record-payment-sheet';
import { VoidInvoiceDialog } from '@/components/billing/void-invoice-dialog';
import { IssueCreditNoteDialog, CancelCreditNoteDialog } from '@/components/billing/credit-note-dialog';
import { openInvoicePdf } from '@/components/billing/invoice-pdf';

import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface InvoiceLine {
  id: string;
  line_type: 'STORAGE' | 'SERVICE' | 'ADJUSTMENT' | 'ADVANCE_APPLIED' | 'SURCHARGE';
  description: string;
  quantity: number;
  unit_price_pkr: number;
  amount_pkr: number;
}
interface LinkedPayment {
  id: string;
  payment_date: string;
  payment_method: string;
  receipt_number: string | null;
  allocated_amount_pkr: number;
}
interface Invoice {
  id: string;
  invoice_number: string | null;
  billing_party_id: string;
  billing_party_name: string;
  lot_id: string;
  lot_number: string;
  invoice_date: string;
  period_start: string;
  period_end: string;
  sub_total_pkr: number;
  discount_type: 'PERCENT' | 'FIXED' | null;
  discount_value: number | null;
  discount_amount_pkr: number;
  gst_rate: number;
  gst_amount_pkr: number;
  total_pkr: number;
  amount_paid_pkr: number;
  amount_credited_pkr: number;
  amount_written_off_pkr: number;
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID' | 'WRITTEN_OFF';
  book_type: 'PACCI' | 'KATCHI';
  finalized_at: string | null;
  void_reason: string | null;
  surcharge_of_invoice_id: string | null;
  can_void: boolean;
  line_items: InvoiceLine[];
}
interface ServiceChargeOption {
  id: string;
  name: string;
  unit_type: 'PER_BAG' | 'PER_TON' | 'FLAT';
  unit_price_pkr: number;
  is_active: boolean;
}
interface Surcharge {
  invoice_id: string | null;
  invoice_number: string | null;
  journal_entry_id: string | null;
  entry_date: string;
  months: number;
  amount_pkr: number;
  status: string;
  description: string;
}
interface CreditNote {
  id: string;
  credit_note_number: string | null;
  credit_date: string;
  reason: string;
  total_pkr: number;
  gst_amount_pkr: number;
  status: string;
  can_cancel: boolean;
}

const LINE_TYPE_TONE: Record<string, 'info' | 'success' | 'danger' | 'warning'> = {
  STORAGE: 'info',
  SERVICE: 'success',
  ADJUSTMENT: 'danger',
  ADVANCE_APPLIED: 'warning',
  SURCHARGE: 'warning',
};

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { user } = useAuthStore();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAddLine, setShowAddLine] = useState(false);
  const [lineType, setLineType] = useState<'SERVICE' | 'ADJUSTMENT'>('SERVICE');
  const [serviceChargeId, setServiceChargeId] = useState('');
  const [serviceCharges, setServiceCharges] = useState<ServiceChargeOption[]>([]);
  const [lineDesc, setLineDesc] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('');
  const [lineSubmitting, setLineSubmitting] = useState(false);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjGstRate, setAdjGstRate] = useState('0');
  const [adjInvoiceDate, setAdjInvoiceDate] = useState('');
  const [adjDiscountType, setAdjDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [adjDiscountValue, setAdjDiscountValue] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);

  const [showPay, setShowPay] = useState(false);
  const [showVoid, setShowVoid] = useState(false);

  const [surcharges, setSurcharges] = useState<Surcharge[]>([]);
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [showCredit, setShowCredit] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CreditNote | null>(null);
  const [surchargeTotal, setSurchargeTotal] = useState(0);
  const [surchargeSubmitting, setSurchargeSubmitting] = useState(false);

  const [linkedPayments, setLinkedPayments] = useState<LinkedPayment[]>([]);

  const canManage = can(user, 'invoices.manage');
  const canVoid = can(user, 'invoices.void');

  const fetchSurcharges = useCallback(async () => {
    try {
      const res = await apiClient<{ total_pkr: number; surcharges: typeof surcharges }>(`/v1/invoices/${id}/surcharges`);
      setSurcharges(res.surcharges);
      setSurchargeTotal(res.total_pkr);
    } catch {
      /* billing.view may be absent; leave surcharges empty */
    }
  }, [id]);

  const fetchCreditNotes = useCallback(async () => {
    try {
      setCreditNotes(await apiClient<CreditNote[]>(`/v1/invoices/${id}/credit-notes`));
    } catch {
      /* billing.view may be absent */
    }
  }, [id]);

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    try {
      setInvoice(await apiClient<Invoice>(`/v1/invoices/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
    fetchSurcharges();
    fetchCreditNotes();
  }, [fetchInvoice, fetchSurcharges, fetchCreditNotes]);

  useEffect(() => {
    if (showAddLine && serviceCharges.length === 0) {
      apiClient<ServiceChargeOption[]>('/v1/service-charges')
        .then((rows) => setServiceCharges(rows.filter((r) => r.is_active)))
        .catch(() => {});
    }
  }, [showAddLine, serviceCharges.length]);

  // Every receipt applied to this invoice, however many the party has (docs/25 R-36).
  const fetchLinkedPayments = useCallback(async () => {
    try {
      const res = await apiClientList<{
        id: string;
        payment_date: string;
        payment_method: string;
        receipt_number: string | null;
        allocations: { invoice_id: string | null; allocated_amount_pkr: number }[];
      }>(`/v1/payments?invoice_id=${id}&page_size=100`);
      setLinkedPayments(
        res.data.flatMap((p) =>
          p.allocations
            .filter((a) => a.invoice_id === id)
            .map((a) => ({
              id: p.id,
              payment_date: p.payment_date,
              payment_method: p.payment_method,
              receipt_number: p.receipt_number,
              allocated_amount_pkr: a.allocated_amount_pkr,
            })),
        ),
      );
    } catch {
      setLinkedPayments([]);
    }
  }, [id]);

  useEffect(() => {
    if (invoice?.status && invoice.status !== 'DRAFT') fetchLinkedPayments();
  }, [invoice?.status, fetchLinkedPayments]);

  async function handleAssessSurcharge() {
    setSurchargeSubmitting(true);
    try {
      const res = await apiClient<{ months_charged: number; amount_pkr: number; surcharge_invoice_number: string }>(
        `/v1/invoices/${id}/surcharges`,
        { method: 'POST', body: {} },
      );
      toast.success(`Surcharge ${res.surcharge_invoice_number} — ${res.months_charged} month(s), ${formatMoney(res.amount_pkr)}`);
      await fetchSurcharges();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to apply surcharge');
    } finally {
      setSurchargeSubmitting(false);
    }
  }

  const selectedCharge = serviceCharges.find((c) => c.id === serviceChargeId);
  const lineReady =
    lineType === 'SERVICE' ? !!selectedCharge : !!lineDesc.trim() && parseFloat(linePrice) > 0;

  async function handleAddLine() {
    if (!lineReady) return;
    setLineSubmitting(true);
    try {
      // A service is the catalog's: the server names and prices it (docs/25 R-28).
      await apiClient(`/v1/invoices/${id}/lines`, {
        method: 'POST',
        body:
          lineType === 'SERVICE'
            ? { line_type: 'SERVICE', service_charge_id: serviceChargeId, quantity: parseFloat(lineQty) || 1 }
            : {
                line_type: 'ADJUSTMENT',
                description: lineDesc,
                quantity: parseFloat(lineQty) || 1,
                unit_price_pkr: parseFloat(linePrice),
              },
      });
      setShowAddLine(false);
      setServiceChargeId('');
      setLineDesc('');
      setLineQty('1');
      setLinePrice('');
      toast.success('Line added');
      await fetchInvoice();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add line');
    } finally {
      setLineSubmitting(false);
    }
  }

  async function handleDeleteLine(lineId: string) {
    const ok = await confirm({
      title: 'Remove this line item?',
      description: 'The invoice total and GST recalculate without it. Nothing has been posted to the books yet — that happens at finalize.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await apiClient(`/v1/invoices/${id}/lines/${lineId}`, { method: 'DELETE' });
      toast.success('Line removed');
      await fetchInvoice();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove line');
    }
  }

  function openAdjust() {
    if (!invoice) return;
    setAdjGstRate(String(invoice.gst_rate));
    setAdjInvoiceDate(invoice.invoice_date);
    setAdjDiscountType(invoice.discount_type ?? 'PERCENT');
    setAdjDiscountValue(invoice.discount_value != null ? String(invoice.discount_value) : '');
    setShowAdjust(true);
  }

  async function handleAdjust(clearDiscount = false) {
    setAdjSubmitting(true);
    try {
      const value = parseFloat(adjDiscountValue);
      await apiClient(`/v1/invoices/${id}`, {
        method: 'PATCH',
        body: {
          gst_rate: parseFloat(adjGstRate) || 0,
          ...(adjInvoiceDate && adjInvoiceDate !== invoice?.invoice_date ? { invoice_date: adjInvoiceDate } : {}),
          discount: clearDiscount
            ? null
            : adjDiscountValue && value > 0
              ? { type: adjDiscountType, value }
              : undefined,
        },
      });
      setShowAdjust(false);
      toast.success('Invoice updated');
      await fetchInvoice();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update invoice');
    } finally {
      setAdjSubmitting(false);
    }
  }

  async function handleFinalize() {
    if (!invoice) return;
    const ok = await confirm({
      title: 'Finalize Invoice',
      description: `This assigns an invoice number and locks the invoice for editing. Total: ${formatMoney(invoice.total_pkr)}.`,
      confirmText: 'Confirm',
    });
    if (!ok) return;
    try {
      await apiClient(`/v1/invoices/${id}/finalize`, { method: 'POST', body: {} });
      toast.success('Invoice finalized');
      await fetchInvoice();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to finalize invoice');
    }
  }

  async function handlePdf() {
    try {
      await openInvoicePdf(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load PDF');
    }
  }

  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!invoice) return null;

  const isDraft = invoice.status === 'DRAFT';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title={invoice.invoice_number ?? 'DRAFT Invoice'}
        crumb={invoice.invoice_number ?? 'Draft'}
        actions={
          <>
            <Button variant="outline" onClick={handlePdf}>
              <FileText className="h-4 w-4" aria-hidden />
              Print PDF
            </Button>
            {canManage && isDraft && (
              <Button onClick={handleFinalize}>Finalize Invoice</Button>
            )}
            {invoice.status === 'FINALIZED' && invoice.balance_due_pkr > 0 && (
              <Button onClick={() => setShowPay(true)}>
                <Banknote className="h-4 w-4" aria-hidden />
                Record Payment
              </Button>
            )}
            {canManage && invoice.status === 'FINALIZED' && invoice.balance_due_pkr > 0 && (
              <Button variant="outline" onClick={() => setShowCredit(true)}>
                Credit Note
              </Button>
            )}
            {canVoid && invoice.can_void && (
              <Button variant="destructive" onClick={() => setShowVoid(true)}>
                Void Invoice
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <StatusBadge status={invoice.status} />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-4 pt-4 text-sm md:grid-cols-3">
          <Info label="Billing Party" value={invoice.billing_party_name} />
          <Info
            label="Lot"
            value={
              <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/lots/${invoice.lot_id}`)}>
                {invoice.lot_number}
              </Button>
            }
          />
          <Info label="Invoice Date" value={formatDate(invoice.invoice_date)} />
          <Info label="Period Start" value={formatDate(invoice.period_start)} />
          <Info label="Period End" value={formatDate(invoice.period_end)} />
          {invoice.finalized_at && <Info label="Finalized At" value={formatDateTime(invoice.finalized_at)} />}
          {invoice.surcharge_of_invoice_id && (
            <Info
              label="Surcharge on"
              value={
                <Button variant="link" className="h-auto p-0" onClick={() => router.push(`/invoices/${invoice.surcharge_of_invoice_id}`)}>
                  overdue invoice
                </Button>
              }
            />
          )}
          {invoice.void_reason && <Info label="Void Reason" value={invoice.void_reason} />}
        </CardContent>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Line Items</h2>
          {canManage && isDraft && (
            <Button size="sm" variant="outline" onClick={() => setShowAddLine(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Add Line
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {canManage && isDraft && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.line_items.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <StatusBadge status={line.line_type} tone={LINE_TYPE_TONE[line.line_type]} />
                </TableCell>
                <TableCell>{line.description}</TableCell>
                <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                <TableCell className="text-right tabular-nums">{line.unit_price_pkr.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{line.amount_pkr.toLocaleString()}</TableCell>
                {canManage && isDraft && (
                  <TableCell className="text-center">
                    {line.line_type !== 'STORAGE' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDeleteLine(line.id)}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="border-t bg-muted/30 px-4 py-4">
          <div className="ml-auto w-72 space-y-1 text-sm">
            {canManage && isDraft && (
              <div className="flex justify-end pb-1">
                <Button variant="link" className="h-auto p-0 text-xs" onClick={openAdjust}>
                  Edit date / discount / GST
                </Button>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">{formatMoney(invoice.sub_total_pkr)}</span>
            </div>
            {invoice.discount_amount_pkr > 0 && (
              <div className="flex justify-between text-amber-700">
                <span>Discount{invoice.discount_type === 'PERCENT' ? ` (${invoice.discount_value}%)` : ''}</span>
                <span className="tabular-nums">− {formatMoney(invoice.discount_amount_pkr)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">GST ({invoice.gst_rate}%)</span>
              <span className="tabular-nums">{formatMoney(invoice.gst_amount_pkr)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(invoice.total_pkr)}</span>
            </div>
            <div className="flex justify-between text-green-700">
              <span>Amount Paid</span>
              <span className="tabular-nums">{formatMoney(invoice.amount_paid_pkr)}</span>
            </div>
            {invoice.amount_credited_pkr > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Credited</span>
                <span className="tabular-nums">{formatMoney(invoice.amount_credited_pkr)}</span>
              </div>
            )}
            {invoice.amount_written_off_pkr > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Written Off</span>
                <span className="tabular-nums">{formatMoney(invoice.amount_written_off_pkr)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-destructive">
              <span>Balance Due</span>
              <span className="tabular-nums">{formatMoney(invoice.balance_due_pkr)}</span>
            </div>
          </div>
        </div>
      </Card>

      {linkedPayments.length > 0 && (
        <Card className="mt-4">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Linked Payments</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linkedPayments.map((p) => (
                <TableRow key={`${p.id}-${p.allocated_amount_pkr}`} className="cursor-pointer" onClick={() => router.push(`/payments/${p.id}`)}>
                  <TableCell className="font-mono text-primary-700">{p.receipt_number ?? p.id.slice(0, 8)}</TableCell>
                  <TableCell>{formatDate(p.payment_date)}</TableCell>
                  <TableCell>{p.payment_method.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-green-700">{formatMoney(p.allocated_amount_pkr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {creditNotes.length > 0 && (
        <Card className="mt-4">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Credit Notes</h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {creditNotes.map((cn) => (
                <TableRow key={cn.id}>
                  <TableCell className="font-mono">{cn.credit_note_number}</TableCell>
                  <TableCell>{formatDate(cn.credit_date)}</TableCell>
                  <TableCell>{cn.reason}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(cn.total_pkr)}</TableCell>
                  <TableCell><StatusBadge status={cn.status} /></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {cn.can_cancel && invoice.status === 'FINALIZED' && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelTarget(cn)}>
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {!invoice.surcharge_of_invoice_id &&
        (surcharges.length > 0 || (canManage && invoice.status === 'FINALIZED' && invoice.balance_due_pkr > 0)) && (
        <Card className="mt-4">
          <CardContent className="pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Late-Payment Surcharges</h3>
              {canManage && invoice.status === 'FINALIZED' && invoice.balance_due_pkr > 0 && (
                <Button size="sm" variant="outline" disabled={surchargeSubmitting} onClick={handleAssessSurcharge}>
                  {surchargeSubmitting ? 'Assessing…' : 'Assess surcharge'}
                </Button>
              )}
            </div>
            {surcharges.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No surcharges applied. If the invoice is overdue beyond the grace period and the facility rule is
                enabled, assessing bills the overdue months as a surcharge invoice of its own.
              </p>
            ) : (
              <div className="space-y-1 text-sm">
                {surcharges.map((s) => (
                  <div key={s.invoice_id} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/invoices/${s.invoice_id}`)}>
                        {s.invoice_number}
                      </Button>{' '}
                      — {s.description}
                      {s.status === 'VOID' && ' (void)'}
                    </span>
                    <span className="tabular-nums">{formatMoney(s.amount_pkr)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>Total surcharges</span>
                  <span className="tabular-nums">{formatMoney(surchargeTotal)}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Line dialog */}
      <Dialog open={showAddLine} onOpenChange={setShowAddLine}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                value={lineType}
                onChange={(e) => setLineType(e.target.value as 'SERVICE' | 'ADJUSTMENT')}
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="SERVICE">Service</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
            </div>
            {lineType === 'SERVICE' ? (
              <div className="space-y-1">
                <Label>Service</Label>
                <select
                  value={serviceChargeId}
                  onChange={(e) => setServiceChargeId(e.target.value)}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Choose a service…</option>
                  {serviceCharges.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {formatMoney(c.unit_price_pkr)} {c.unit_type === 'FLAT' ? 'flat' : c.unit_type === 'PER_BAG' ? 'per bag' : 'per ton'}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label>Description</Label>
                <Input value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} placeholder="e.g. Extra handling" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {(lineType === 'ADJUSTMENT' || selectedCharge?.unit_type !== 'FLAT') && (
                <div className="space-y-1">
                  <Label>{selectedCharge?.unit_type === 'PER_TON' ? 'Tons' : selectedCharge?.unit_type === 'PER_BAG' ? 'Bags' : 'Quantity'}</Label>
                  <Input type="number" min={0.01} step={0.01} value={lineQty} onChange={(e) => setLineQty(e.target.value)} className="tabular-nums" />
                </div>
              )}
              {lineType === 'ADJUSTMENT' && (
                <div className="space-y-1">
                  <Label>Unit Price (PKR)</Label>
                  <Input type="number" min={0.01} step={0.01} value={linePrice} onChange={(e) => setLinePrice(e.target.value)} className="tabular-nums" />
                </div>
              )}
            </div>
            {lineType === 'ADJUSTMENT' && (
              <p className="text-xs text-muted-foreground">An adjustment adds a charge. To reduce the invoice, give a discount.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLine(false)}>Cancel</Button>
            <Button onClick={handleAddLine} disabled={lineSubmitting || !lineReady}>
              {lineSubmitting ? 'Adding…' : 'Add Line'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discount / GST dialog */}
      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Date, Discount &amp; GST</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Invoice Date</Label>
                <Input type="date" min={invoice.period_end} value={adjInvoiceDate} onChange={(e) => setAdjInvoiceDate(e.target.value)} className="tabular-nums" />
              </div>
              {invoice.book_type === 'PACCI' && (
                <div className="space-y-1">
                  <Label>GST Rate (%)</Label>
                  <Input type="number" min={0} max={100} step={0.5} value={adjGstRate} onChange={(e) => setAdjGstRate(e.target.value)} className="tabular-nums" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Discount Type</Label>
                <select
                  value={adjDiscountType}
                  onChange={(e) => setAdjDiscountType(e.target.value as 'PERCENT' | 'FIXED')}
                  className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="PERCENT">Percent (%)</option>
                  <option value="FIXED">Fixed (PKR)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>Value{adjDiscountType === 'PERCENT' ? ' (%)' : ' (PKR)'}</Label>
                <Input type="number" min={0} step={0.01} value={adjDiscountValue} onChange={(e) => setAdjDiscountValue(e.target.value)} placeholder="No discount" className="tabular-nums" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              GST is calculated on the post-discount amount. The discount posts to the Discounts Allowed account when the invoice is finalized.
            </p>
          </div>
          <DialogFooter className="sm:justify-between">
            {invoice.discount_amount_pkr > 0 ? (
              <Button variant="outline" className="text-destructive" onClick={() => handleAdjust(true)} disabled={adjSubmitting}>
                Remove Discount
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowAdjust(false)}>Cancel</Button>
              <Button onClick={() => handleAdjust(false)} disabled={adjSubmitting}>
                {adjSubmitting ? 'Saving…' : 'Apply'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RecordPaymentSheet
        open={showPay}
        onOpenChange={setShowPay}
        partyId={invoice.billing_party_id}
        partyName={invoice.billing_party_name}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        invoiceBalance={invoice.balance_due_pkr}
        onSuccess={() => {
          setShowPay(false);
          fetchInvoice();
        }}
      />
      <IssueCreditNoteDialog
        open={showCredit}
        onOpenChange={setShowCredit}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        lines={invoice.line_items}
        onDone={() => {
          fetchInvoice();
          fetchCreditNotes();
        }}
      />
      <CancelCreditNoteDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        creditNote={cancelTarget}
        onDone={() => {
          setCancelTarget(null);
          fetchInvoice();
          fetchCreditNotes();
        }}
      />
      <VoidInvoiceDialog
        open={showVoid}
        onOpenChange={setShowVoid}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        onSuccess={() => {
          setShowVoid(false);
          fetchInvoice();
        }}
      />
    </div>
  );
}
