'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const MIN_REASON = 3;

/**
 * Cancel a withdrawal that has not left — modelled on VoidInvoiceDialog: a
 * required reason, one request. The server frees the bags it was holding.
 * Errors stay inside the dialog so the typed reason is not lost.
 * Used by the withdrawal page and by the Dispatch Desk rows.
 */
export function CancelWithdrawalDialog<T = unknown>({
  open,
  onOpenChange,
  eventId,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  onCancelled: (event: T) => void;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await apiClient<T>(`/v1/outbound-events/${eventId}/cancel`, {
        method: 'POST',
        body: { reason: trimmed },
      });
      setReason('');
      onOpenChange(false);
      onCancelled(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel the withdrawal');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this withdrawal?</DialogTitle>
          <DialogDescription>
            Use this if these bags are not going out. They go back to the lot. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Truck did not come"
            maxLength={400}
            rows={3}
          />
        </div>
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button variant="destructive" disabled={trimmed.length < MIN_REASON || saving} onClick={submit}>
            {saving ? 'Cancelling…' : 'Cancel withdrawal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
