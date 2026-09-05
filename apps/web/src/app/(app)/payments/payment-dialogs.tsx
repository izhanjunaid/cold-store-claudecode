'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const today = () => new Date().toISOString().slice(0, 10);

interface ChequeDialogProps<T> {
  paymentId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the updated payment, so a detail page can set state and a list can refetch. */
  onDone: (updated: T) => void;
}

/**
 * Cheque lifecycle dialogs, shared by the payments list rows and
 * `/payments/[id]` — the same components in both places rather than a
 * duplicate per surface (the pattern `expense-voucher-dialogs.tsx` set).
 * Both actions are `payments.record`; callers gate the trigger.
 */
export function PaymentClearDialog<T>({
  paymentId,
  open,
  onOpenChange,
  onDone,
}: ChequeDialogProps<T>) {
  const [clearDate, setClearDate] = useState(today);
  const [submitting, setSubmitting] = useState(false);

  const handleClear = async () => {
    if (!paymentId) return;
    setSubmitting(true);
    try {
      const updated = await apiClient<T>(`/v1/payments/${paymentId}/clear`, {
        method: 'POST',
        body: { clear_date: clearDate },
      });
      toast.success('Cheque marked cleared');
      onOpenChange(false);
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Cheque Cleared</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This cheque is parked in 1025 (Cheques in Hand) until the bank processes it. Marking it
          cleared moves the amount into Bank Account — Main.
        </p>
        <div className="space-y-1">
          <Label>Cleared date</Label>
          <Input
            type="date"
            value={clearDate}
            onChange={(e) => setClearDate(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleClear} disabled={submitting}>
            {submitting ? 'Processing…' : 'Mark Cleared'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentDishonourDialog<T>({
  paymentId,
  open,
  onOpenChange,
  onDone,
}: ChequeDialogProps<T>) {
  const [dishonourDate, setDishonourDate] = useState(today);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleDishonour = async () => {
    if (!paymentId) return;
    setSubmitting(true);
    try {
      const updated = await apiClient<T>(`/v1/payments/${paymentId}/dishonour`, {
        method: 'POST',
        body: { notes: notes || undefined, dishonour_date: dishonourDate },
      });
      toast.success('Cheque dishonoured');
      onOpenChange(false);
      onDone(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dishonour payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark Cheque Dishonoured</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          All allocations will be reversed and invoice balances restored.
        </p>
        <div className="space-y-1">
          <Label>Dishonour date</Label>
          <Input
            type="date"
            value={dishonourDate}
            onChange={(e) => setDishonourDate(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1">
          <Label>Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Reason for dishonour (optional)"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDishonour} disabled={submitting}>
            {submitting ? 'Processing…' : 'Confirm Dishonour'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
