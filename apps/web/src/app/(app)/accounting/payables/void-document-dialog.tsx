'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Void a posted payables / treasury document. The server reverses its entry and keeps
 * the row; this only collects the reason. Whether the action is offered at all comes
 * from the document's `allowed_actions`, never from a rule here (docs/25 C-11).
 */
export function VoidDocumentDialog({
  title,
  explanation,
  url,
  open,
  onOpenChange,
  onVoided,
}: {
  title: string;
  explanation: string;
  /** The document's void endpoint. */
  url: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVoided: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 3;

  const submit = async () => {
    if (!url) return;
    setBusy(true);
    try {
      await apiClient(url, { method: 'POST', body: { reason: reason.trim() } });
      toast.success(`${title} — done`);
      setReason('');
      onOpenChange(false);
      onVoided();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not void');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{explanation}</p>
        <div className="space-y-1.5">
          <Label htmlFor="void-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy || !valid}
            onClick={submit}
          >
            Void
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
