'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { localIsoDate } from '@coldchain/shared';
import { formatMoney } from '@/lib/format';

export interface CreditableLine {
  id: string;
  line_type: string;
  description: string;
  amount_pkr: number;
}

interface IssueCreditNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string | null;
  lines: CreditableLine[];
  onDone: () => void;
}

/**
 * Issue a credit note against an invoice's own lines. The server reverses each
 * line's revenue account and the matching share of the discount and sales tax
 * (docs/25 R-03), so the user enters only how much of each line to credit.
 */
export function IssueCreditNoteDialog({ open, onOpenChange, invoiceId, invoiceNumber, lines, onDone }: IssueCreditNoteDialogProps) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [creditDate, setCreditDate] = useState(() => localIsoDate());
  const [submitting, setSubmitting] = useState(false);

  const items = lines
    .map((l) => ({ line: l, amount: parseFloat(amounts[l.id] ?? '') || 0 }))
    .filter((i) => i.amount > 0);
  const revenue = items.reduce((s, i) => s + i.amount, 0);

  const submit = async () => {
    setSubmitting(true);
    try {
      await apiClient('/v1/credit-notes', {
        method: 'POST',
        body: {
          original_invoice_id: invoiceId,
          credit_date: creditDate,
          reason,
          line_items: items.map((i) => ({ invoice_line_item_id: i.line.id, amount_pkr: i.amount })),
        },
      });
      toast.success('Credit note issued');
      setAmounts({});
      setReason('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to issue credit note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Credit note — {invoiceNumber ?? 'invoice'}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Enter how much of each line to credit, before discount and tax. The matching share of the
          invoice&apos;s discount and sales tax is reversed with it.
        </p>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_8rem] items-center gap-2">
              <Label className="font-normal">
                {l.description} <span className="text-muted-foreground">({formatMoney(l.amount_pkr)})</span>
              </Label>
              <Input
                type="number"
                min={0}
                max={l.amount_pkr}
                step={0.01}
                value={amounts[l.id] ?? ''}
                onChange={(e) => setAmounts((prev) => ({ ...prev, [l.id]: e.target.value }))}
                className="tabular-nums"
                aria-label={`Credit on ${l.description}`}
              />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Credit date</Label>
            <Input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label>Revenue credited</Label>
            <p className="pt-1.5 text-sm font-medium tabular-nums">{formatMoney(revenue)}</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. short weight on dispatch" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || items.length === 0 || !reason.trim()}>
            {submitting ? 'Issuing…' : 'Issue Credit Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CancelCreditNoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditNote: { id: string; credit_note_number: string | null } | null;
  onDone: () => void;
}

/** Cancel a credit note: its entry is reversed and the invoice owes the amount again. */
export function CancelCreditNoteDialog({ open, onOpenChange, creditNote, onDone }: CancelCreditNoteDialogProps) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!creditNote) return;
    setSubmitting(true);
    try {
      await apiClient(`/v1/credit-notes/${creditNote.id}/cancel`, { method: 'POST', body: { reason } });
      toast.success('Credit note cancelled');
      setReason('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel credit note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel credit note {creditNote?.credit_note_number}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          The credit note&apos;s entry is reversed and the invoice owes the credited amount again.
        </p>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting || !reason.trim()}>
            {submitting ? 'Cancelling…' : 'Cancel Credit Note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
