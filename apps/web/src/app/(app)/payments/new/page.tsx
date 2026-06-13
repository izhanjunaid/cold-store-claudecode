'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

interface Party {
  id: string;
  name: string;
  party_type?: string;
  is_active: boolean;
}
interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  balance_due_pkr: number;
}
interface AllocationRow {
  invoice_id: string;
  allocated_amount_pkr: string;
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPartyId = searchParams.get('party_id') ?? '';

  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [partyId, setPartyId] = useState(preselectedPartyId);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountPkr, setAmountPkr] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [chequeDate, setChequeDate] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  useEffect(() => {
    apiClientList<Party>('/v1/parties?page_size=200&is_active=true')
      .then((res) => setParties(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchInvoices = useCallback(async (pid: string) => {
    if (!pid) {
      setInvoices([]);
      return;
    }
    try {
      const res = await apiClientList<InvoiceSummary>(
        `/v1/invoices?party_id=${pid}&status=FINALIZED&page_size=100`,
      );
      setInvoices(res.data.filter((i) => i.balance_due_pkr > 0));
    } catch {
      setInvoices([]);
    }
  }, []);

  useEffect(() => {
    fetchInvoices(partyId);
  }, [partyId, fetchInvoices]);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, hint: p.party_type })),
    [parties],
  );

  const totalAllocated = allocations.reduce((s, a) => s + (parseFloat(a.allocated_amount_pkr) || 0), 0);

  const updateAllocation = (idx: number, field: keyof AllocationRow, value: string) =>
    setAllocations((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));

  const fillBalance = (idx: number) => {
    const alloc = allocations[idx];
    const inv = invoices.find((i) => i.id === alloc?.invoice_id);
    if (inv) updateAllocation(idx, 'allocated_amount_pkr', String(inv.balance_due_pkr));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyId) return setError('Please select a party.');
    if (!amountPkr || parseFloat(amountPkr) <= 0) return setError('Amount must be positive.');

    const validAllocations = isAdvance
      ? []
      : allocations
          .filter((a) => a.invoice_id && parseFloat(a.allocated_amount_pkr) > 0)
          .map((a) => ({ invoice_id: a.invoice_id, allocated_amount_pkr: parseFloat(a.allocated_amount_pkr) }));

    setSubmitting(true);
    setError('');
    try {
      const result = await apiClient<{ id: string }>('/v1/payments', {
        method: 'POST',
        body: {
          party_id: partyId,
          payment_date: paymentDate,
          amount_pkr: parseFloat(amountPkr),
          payment_method: paymentMethod,
          reference_number: referenceNumber || undefined,
          is_advance: isAdvance,
          cheque_date: paymentMethod === 'CHEQUE' && chequeDate ? chequeDate : undefined,
          notes: notes || undefined,
          allocations: validAllocations,
        },
      });
      toast.success('Payment recorded');
      router.push(`/payments/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Record Payment" crumb="New" />

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <Label>Party <span className="text-destructive">*</span></Label>
              <Combobox
                options={partyOptions}
                value={partyId}
                onChange={(v) => {
                  setPartyId(v);
                  setAllocations([]);
                }}
                placeholder="Select party…"
                searchPlaceholder="Search parties…"
                testId="combobox-party_id"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Date <span className="text-destructive">*</span></Label>
                <Input type="date" name="payment_date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="tabular-nums" required />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (PKR) <span className="text-destructive">*</span></Label>
                <Input type="number" name="amount_pkr" min={0.01} step={0.01} value={amountPkr} onChange={(e) => setAmountPkr(e.target.value)} placeholder="0.00" className="tabular-nums" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Payment Method <span className="text-destructive">*</span></Label>
                <select name="payment_method" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={SELECT_CLASS}>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="MOBILE_WALLET">Mobile Wallet</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Reference Number</Label>
                <Input name="reference_number" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Cheque #, transfer ref…" />
              </div>
            </div>

            {paymentMethod === 'CHEQUE' && (
              <div className="space-y-1.5">
                <Label>Cheque Date</Label>
                <Input type="date" name="cheque_date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} className="tabular-nums" />
              </div>
            )}

            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={isAdvance} onCheckedChange={(c) => { setIsAdvance(!!c); setAllocations([]); }} />
              Advance payment (no invoice allocation)
            </label>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </CardContent>
        </Card>

        {!isAdvance && (
          <Card>
            <CardContent className="pt-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Invoice Allocations</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAllocations((prev) => [...prev, { invoice_id: '', allocated_amount_pkr: '' }])}
                  disabled={!partyId || invoices.length === 0}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add Invoice
                </Button>
              </div>

              {partyId && invoices.length === 0 && (
                <p className="text-sm italic text-muted-foreground">
                  No finalized invoices with outstanding balance for this party.
                </p>
              )}

              {allocations.map((alloc, idx) => (
                <div key={idx} className="mb-3 flex items-end gap-3">
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Invoice</Label>
                    <select
                      name="allocation_invoice"
                      value={alloc.invoice_id}
                      onChange={(e) => updateAllocation(idx, 'invoice_id', e.target.value)}
                      className={SELECT_CLASS}
                    >
                      <option value="">Select invoice…</option>
                      {invoices.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoice_number ?? 'Draft'} — Balance: PKR {inv.balance_due_pkr.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-40 space-y-1.5">
                    <Label className="text-xs">Amount (PKR)</Label>
                    <Input
                      type="number"
                      name="allocation_amount"
                      min={0.01}
                      step={0.01}
                      value={alloc.allocated_amount_pkr}
                      onChange={(e) => updateAllocation(idx, 'allocated_amount_pkr', e.target.value)}
                      placeholder="0.00"
                      className="tabular-nums"
                    />
                  </div>
                  {alloc.invoice_id && (
                    <Button type="button" variant="link" className="h-9 px-1 text-xs" onClick={() => fillBalance(idx)}>
                      Fill balance
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive"
                    onClick={() => setAllocations((prev) => prev.filter((_, i) => i !== idx))}
                    aria-label="Remove allocation"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              {allocations.length > 0 && (
                <div className="mt-2 text-right text-sm text-muted-foreground">
                  Total allocated: <span className="font-medium tabular-nums">PKR {totalAllocated.toLocaleString()}</span>
                  {amountPkr && (
                    <span className={cn('ml-2', totalAllocated > parseFloat(amountPkr) ? 'text-destructive' : 'text-green-600')}>
                      / PKR {parseFloat(amountPkr).toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Recording…' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </div>
  );
}
