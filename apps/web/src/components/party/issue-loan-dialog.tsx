'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface LoanCreated {
  id: string;
  loan_number: string;
  principal_pkr: number;
  issue_journal_entry_id: string | null;
}

export interface IssueLoanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyId: string;
  partyName?: string;
  onSuccess?: () => void;
}

/**
 * Fast-path peshgi issuance for the simple, single-party case, mounted from
 * the party record. /loans/issue stays the full page for the command
 * palette and its own search-a-party flow.
 */
export function IssueLoanDialog({ open, onOpenChange, partyId, partyName, onSuccess }: IssueLoanDialogProps) {
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [principal, setPrincipal] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setIssueDate(new Date().toISOString().slice(0, 10));
    setPrincipal('');
    setPaymentMethod('CASH');
    setNotes('');
  }, [open]);

  const issue = useApiMutation<LoanCreated, void>({
    mutationFn: () =>
      apiClient<LoanCreated>('/v1/loans/issue', {
        method: 'POST',
        body: {
          party_id: partyId,
          issue_date: issueDate,
          principal_pkr: Number(principal),
          payment_method: paymentMethod,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      }),
    invalidates: [qk.loans.all],
    successMessage: (data) => `Peshgi ${data.loan_number} issued`,
    onSuccess: () => {
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const principalNum = Number(principal);
  const canSubmit = Number.isFinite(principalNum) && principalNum > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issue Peshgi{partyName ? ` — ${partyName}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>
                Principal (PKR) <span className="text-destructive">*</span>
              </Label>
              <Input
                type="number"
                step={0.01}
                min={0.01}
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Issue date <span className="text-destructive">*</span>
              </Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="tabular-nums" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>
              Payment method <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2">
              {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant={paymentMethod === m ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPaymentMethod(m)}
                >
                  {m === 'CASH' ? 'Cash (1010)' : 'Bank Transfer (1020)'}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => issue.mutate()} disabled={!canSubmit || issue.isPending}>
            {issue.isPending ? 'Issuing…' : 'Issue Peshgi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
