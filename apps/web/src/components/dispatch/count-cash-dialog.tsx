'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient, ApiError } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface CashRow {
  user_id: string;
  user_name: string;
  pending_cash_pkr: number | null;
  pending_receipts: number;
  pending_since: string | null;
}

/**
 * A manager counts the cash a collector took. The figure shown is what the receipts say; what was
 * counted is typed in, and any difference needs its reason. The server is sent the figure that was
 * shown: if a truck was paid meanwhile it refuses with the new one instead of booking a false difference.
 */
export function CountCashDialog({
  open,
  onOpenChange,
  collector,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collector: CashRow;
}) {
  const queryClient = useQueryClient();
  const expected = collector.pending_cash_pkr ?? 0;
  const [counted, setCounted] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The figure the count was started against. The card refetches while the dialog is open; if the
  // collector took more cash meanwhile, a count typed against the old figure must not be sent
  // against the new one (it would book a false shortage), so it is cleared and the manager told.
  const [startedAt, setStartedAt] = useState(expected);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (open) {
      setCounted('');
      setReason('');
      setError(null);
      setStartedAt(collector.pending_cash_pkr ?? 0);
      setChanged(false);
    }
    // Reset on opening, or on another collector — not on every refetch of this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collector.user_id]);

  useEffect(() => {
    if (!open || expected === startedAt) return;
    setCounted('');
    setReason('');
    setStartedAt(expected);
    setChanged(true);
  }, [open, expected, startedAt]);

  const countedNum = counted.trim() === '' ? null : Number(counted);
  const valid = countedNum != null && Number.isFinite(countedNum) && countedNum >= 0;
  const variance = valid ? Math.round((countedNum - expected) * 100) / 100 : 0;
  const needsReason = valid && variance !== 0;
  const canSubmit = valid && !saving && (!needsReason || reason.trim().length >= 3);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const h = await apiClient<{ handover_number: string }>('/v1/cash-handovers', {
        method: 'POST',
        body: {
          collector_id: collector.user_id,
          expected_cash_pkr: expected,
          counted_cash_pkr: countedNum,
          ...(needsReason ? { variance_reason: reason.trim() } : {}),
        },
      });
      toast.success(`Handover ${h.handover_number} recorded`);
      await queryClient.invalidateQueries({ queryKey: qk.outbound.day });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'HANDOVER_EXPECTED_CHANGED') {
        // The figure moved: show the new one and make them count again.
        await queryClient.invalidateQueries({ queryKey: qk.outbound.day });
      }
      setError(e instanceof Error ? e.message : 'Could not record the handover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Count cash — {collector.user_name}</DialogTitle>
          <DialogDescription>
            {collector.pending_receipts} receipt{collector.pending_receipts === 1 ? '' : 's'}
            {collector.pending_since ? ` since ${formatDate(collector.pending_since)}` : ''}. Count the notes, then enter
            what you counted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between rounded-md border bg-muted/40 px-3 py-2">
            <span className="text-sm text-muted-foreground">The receipts say</span>
            <span className="text-lg font-semibold tabular-nums">{formatMoney(expected)}</span>
          </div>
          {changed && (
            <p role="status" className="text-sm font-medium text-amber-700">
              The cash waiting changed while you were counting (another receipt came in). Count it again.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="counted-cash">Cash counted (PKR)</Label>
            <Input
              id="counted-cash"
              type="number"
              min={0}
              step="0.01"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="tabular-nums"
            />
          </div>
          {valid && variance !== 0 && (
            <p className={variance < 0 ? 'text-sm font-medium text-destructive' : 'text-sm font-medium text-amber-700'}>
              {variance < 0 ? 'Short by' : 'Over by'} {formatMoney(Math.abs(variance))}
            </p>
          )}
          {needsReason && (
            <div className="space-y-1">
              <Label htmlFor="variance-reason">Why does it differ?</Label>
              <Textarea
                id="variance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={400}
                placeholder="e.g. a torn note was discarded"
              />
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {saving ? 'Recording…' : variance === 0 ? 'Record handover' : 'Record handover with difference'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
