'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { qk } from '@/lib/query-keys';
import { formatMoney } from '@/lib/format';
import { localIsoDate } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface CreditApproval {
  approved: boolean;
  id: string | null;
  /** Only for holders of parties.credit_terms; null for everyone else. */
  max_outstanding_pkr: number | null;
  valid_until: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  note: string | null;
}

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyId: string;
  partyName?: string;
}

/**
 * Approve a party for credit up to a ceiling, optionally until a date. Replaces any approval it already
 * has. A first approval starts from the party's own credit limit (the warning threshold on its record),
 * so the two do not drift apart by accident; the manager can still set a different ceiling.
 */
export function GrantCreditApprovalDialog({
  open,
  onOpenChange,
  partyId,
  partyName,
  current,
  creditLimitPkr,
}: DialogProps & { current?: CreditApproval | null; creditLimitPkr?: number | null }) {
  const [max, setMax] = useState('');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setMax(
      current?.max_outstanding_pkr
        ? String(current.max_outstanding_pkr)
        : creditLimitPkr
          ? String(creditLimitPkr)
          : '',
    );
    setUntil(current?.valid_until ?? '');
    setNote(current?.note ?? '');
  }, [open, current, creditLimitPkr]);

  const grant = useApiMutation<CreditApproval, void>({
    mutationFn: () =>
      apiClient<CreditApproval>(`/v1/parties/${partyId}/credit-approval`, {
        method: 'POST',
        body: {
          max_outstanding_pkr: Number(max),
          ...(until ? { valid_until: until } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      }),
    invalidates: [qk.parties.creditApproval(partyId)],
    successMessage: 'Credit approved',
    onSuccess: () => onOpenChange(false),
  });

  const maxNum = Number(max);
  const canSubmit = Number.isFinite(maxNum) && maxNum > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve credit{partyName ? ` — ${partyName}` : ''}</DialogTitle>
          <DialogDescription>
            While this holds, a truck of this party billed on credit can leave the gate without a manager. The
            ceiling is the most the party may owe in total, this truck included.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="credit-max">
              Most the party may owe (PKR) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="credit-max"
              type="number"
              min={1}
              step={1}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="tabular-nums"
            />
            {creditLimitPkr ? (
              <p className="text-xs text-muted-foreground">This party&apos;s credit limit is {formatMoney(creditLimitPkr)}.</p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="credit-until">Valid until</Label>
            <Input
              id="credit-until"
              type="date"
              min={localIsoDate()}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="tabular-nums"
            />
            <p className="text-xs text-muted-foreground">Leave empty to hold until revoked.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="credit-note">Note</Label>
            <Textarea id="credit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={400} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => grant.mutate()} disabled={!canSubmit || grant.isPending}>
            {grant.isPending ? 'Saving…' : 'Approve credit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** End an approval, with the reason on record. Trucks of the party wait for a manager again. */
export function RevokeCreditApprovalDialog({ open, onOpenChange, partyId, partyName }: DialogProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const revoke = useApiMutation<CreditApproval, void>({
    mutationFn: () =>
      apiClient<CreditApproval>(`/v1/parties/${partyId}/credit-approval/revoke`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    invalidates: [qk.parties.creditApproval(partyId)],
    successMessage: 'Credit approval revoked',
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke credit approval{partyName ? ` — ${partyName}` : ''}</DialogTitle>
          <DialogDescription>
            Trucks of this party billed on credit will need a manager at the gate again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="revoke-reason">Reason</Label>
          <Textarea
            id="revoke-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cheque bounced"
            rows={2}
            maxLength={400}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Go back
          </Button>
          <Button variant="destructive" onClick={() => revoke.mutate()} disabled={reason.trim().length < 3 || revoke.isPending}>
            {revoke.isPending ? 'Revoking…' : 'Revoke approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
