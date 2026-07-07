'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, FileText, Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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

import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface InvoiceLine {
  id: string;
  line_type: 'STORAGE' | 'SERVICE' | 'ADJUSTMENT' | 'ADVANCE_APPLIED';
  description: string;
  quantity: number;
  unit_price_pkr: number;
  amount_pkr: number;
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
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
  finalized_at: string | null;
  line_items: InvoiceLine[];
}

const LINE_TYPE_TONE: Record<string, 'info' | 'success' | 'danger' | 'warning'> = {
  STORAGE: 'info',
  SERVICE: 'success',
  ADJUSTMENT: 'danger',
  ADVANCE_APPLIED: 'warning',
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
  const [lineDesc, setLineDesc] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('');
  const [lineSubmitting, setLineSubmitting] = useState(false);

  const [showAdjust, setShowAdjust] = useState(false);
  const [adjGstRate, setAdjGstRate] = useState('0');
  const [adjDiscountType, setAdjDiscountType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [adjDiscountValue, setAdjDiscountValue] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);

  const canManage = !!user && hasMinRole(user.role, 'MANAGER');

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
  }, [fetchInvoice]);

  async function handleAddLine() {
    if (!lineDesc.trim() || !linePrice) return;
    setLineSubmitting(true);
    try {
      await apiClient(`/v1/invoices/${id}/lines`, {
        method: 'POST',
        body: {
          line_type: lineType,
          description: lineDesc,
          quantity: parseFloat(lineQty) || 1,
          unit_price_pkr: parseFloat(linePrice),
        },
      });
      setShowAddLine(false);
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
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/invoices/${id}/pdf`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to load PDF');
      window.open(URL.createObjectURL(await res.blob()), '_blank');
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
              <Button onClick={() => router.push(`/payments/new?party_id=${invoice.billing_party_id}`)}>
                <Banknote className="h-4 w-4" aria-hidden />
                Record Payment
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4">
        <StatusBadge status={invoice.status} />
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm md:grid-cols-3">
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
                    {line.line_type !== 'STORAGE' && line.line_type !== 'ADVANCE_APPLIED' && (
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
                  Edit discount / GST
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
            <div className="flex justify-between font-bold text-destructive">
              <span>Balance Due</span>
              <span className="tabular-nums">{formatMoney(invoice.balance_due_pkr)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Add Line dialog */}
      <Dialog open={showAddLine} onOpenChange={setShowAddLine}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Line Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <select
                value={lineType}
                onChange={(e) => setLineType(e.target.value as 'SERVICE' | 'ADJUSTMENT')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="SERVICE">Service</option>
                <option value="ADJUSTMENT">Adjustment</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input value={lineDesc} onChange={(e) => setLineDesc(e.target.value)} placeholder="e.g. Loading charge" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={0.01} step={0.01} value={lineQty} onChange={(e) => setLineQty(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Unit Price (PKR){lineType === 'ADJUSTMENT' ? ' (±)' : ''}</Label>
                <Input type="number" step={0.01} value={linePrice} onChange={(e) => setLinePrice(e.target.value)} className="tabular-nums" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddLine(false)}>Cancel</Button>
            <Button onClick={handleAddLine} disabled={lineSubmitting || !lineDesc.trim() || !linePrice}>
              {lineSubmitting ? 'Adding…' : 'Add Line'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discount / GST dialog */}
      <Dialog open={showAdjust} onOpenChange={setShowAdjust}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discount &amp; GST</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>GST Rate (%)</Label>
              <Input type="number" min={0} max={100} step={0.5} value={adjGstRate} onChange={(e) => setAdjGstRate(e.target.value)} className="tabular-nums" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Discount Type</Label>
                <select
                  value={adjDiscountType}
                  onChange={(e) => setAdjDiscountType(e.target.value as 'PERCENT' | 'FIXED')}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="PERCENT">Percent (%)</option>
                  <option value="FIXED">Fixed (PKR)</option>
                </select>
              </div>
              <div className="space-y-1.5">
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
    </div>
  );
}
