'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface VoidInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber?: string | null;
  onSuccess?: () => void;
}

/**
 * Shared void-invoice dialog — mounted from the invoice detail page and
 * from a list row action. Void is financially consequential (reverses the
 * posted JE), so it stays its own confirming dialog with a required reason,
 * not a bare confirm() — same shape either place it's opened from.
 */
export function VoidInvoiceDialog({ open, onOpenChange, invoiceId, invoiceNumber, onSuccess }: VoidInvoiceDialogProps) {
  const [reason, setReason] = useState('');

  const voidInvoice = useApiMutation<unknown, void>({
    mutationFn: () => apiClient(`/v1/invoices/${invoiceId}/void`, { method: 'POST', body: { reason: reason.trim() } }),
    invalidates: [qk.invoices.all],
    successMessage: 'Invoice voided',
    onSuccess: () => {
      setReason('');
      onOpenChange(false);
      onSuccess?.();
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Void Invoice{invoiceNumber ? ` ${invoiceNumber}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            This reverses the invoice&apos;s journal entry and marks it VOID. Only allowed while the
            invoice is unpaid with no credit notes. This cannot be undone.
          </p>
          <div className="space-y-1">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this invoice being voided?"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!reason.trim() || voidInvoice.isPending} onClick={() => voidInvoice.mutate()}>
            {voidInvoice.isPending ? 'Voiding…' : 'Void Invoice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
