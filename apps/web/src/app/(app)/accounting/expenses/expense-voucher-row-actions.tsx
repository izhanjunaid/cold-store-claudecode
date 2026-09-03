'use client';

import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/form';

export interface ActionableVoucher {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
  is_accrual: boolean;
}

/**
 * Approve / Accrue / Cancel fire directly (each is a single POST, no fields);
 * Edit and Pay open the shared dialogs via callbacks up to the list page.
 * Self-sufficient on permissions (reads useAuthStore/can itself, matching
 * JournalEntryPeek's precedent) so the list's `columns` only has to wire
 * voucher + callbacks, not thread permission booleans through too.
 */
export function ExpenseVoucherRowActions({
  voucher, onEdit, onPay, onChanged,
}: {
  voucher: ActionableVoucher;
  onEdit: () => void;
  onPay: () => void;
  onChanged: () => void;
}) {
  const { user } = useAuthStore();
  const canApprove = can(user, 'expenses.approve');
  const canRecord = can(user, 'expenses.record');
  const confirm = useConfirm();

  async function fire(path: string, body: unknown, successMsg: string, failMsg: string) {
    try {
      await apiClient(`/v1/expense-vouchers/${voucher.id}/${path}`, { method: 'POST', body });
      toast.success(successMsg);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failMsg);
    }
  }

  async function cancelVoucher() {
    if (await confirm({
      title: 'Cancel this voucher?',
      description: 'The voucher is closed and cannot be approved or paid afterwards. No ledger entry is affected — accrued or paid vouchers cannot be cancelled.',
      confirmText: 'Cancel Voucher',
      destructive: true,
    })) {
      fire('cancel', { reason: 'Cancelled from UI' }, 'Voucher cancelled', 'Cancel failed');
    }
  }

  if (!canApprove && !canRecord) return null;

  return (
    // One stopPropagation for the whole cell rather than per-button — any
    // click here must never bubble to the row's onClick (navigate to detail).
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canRecord && voucher.status === 'DRAFT' && (
        <Button variant="ghost" size="sm" onClick={onEdit}>Edit</Button>
      )}
      {canApprove && voucher.status === 'DRAFT' && (
        <Button size="sm" onClick={() => fire('approve', {}, 'Approved', 'Approve failed')}>Approve</Button>
      )}
      {canRecord && voucher.status === 'APPROVED' && voucher.is_accrual && (
        <Button size="sm" onClick={() => fire('accrue', {}, 'Accrued', 'Accrue failed')}>Accrue</Button>
      )}
      {canRecord && (voucher.status === 'APPROVED' || voucher.status === 'ACCRUED') && (
        <Button size="sm" onClick={onPay}>Pay</Button>
      )}
      {canApprove && (voucher.status === 'DRAFT' || voucher.status === 'APPROVED') && (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={cancelVoucher}>Cancel</Button>
      )}
    </div>
  );
}
