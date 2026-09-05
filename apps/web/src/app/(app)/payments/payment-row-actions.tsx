'use client';

import { Button } from '@/components/ui/button';
import type { PaymentRow } from './columns';

interface PaymentRowActionsProps {
  payment: PaymentRow;
  /** `payments.record` — the same key the API enforces on all three endpoints. */
  canRecord: boolean;
  onClear: (payment: PaymentRow) => void;
  onDishonour: (payment: PaymentRow) => void;
  onApplyAdvance: (payment: PaymentRow) => void;
}

/**
 * Cheque clearing, dishonour and advance application, from the list row —
 * none of the three needs the detail page (spec §5: a single POST or a small
 * dialog belongs on the list). `/payments/[id]` stays as the bookmarkable
 * fallback and shares the same dialogs.
 */
export function PaymentRowActions({
  payment,
  canRecord,
  onClear,
  onDishonour,
  onApplyAdvance,
}: PaymentRowActionsProps) {
  const isCheque = payment.payment_method === 'CHEQUE';
  const canClear = canRecord && isCheque && payment.clearance_status === 'PENDING';
  const canDishonour = canRecord && isCheque && payment.status !== 'DISHONOURED';
  const canApplyAdvance = canRecord && payment.status === 'ADVANCE';

  if (!canClear && !canDishonour && !canApplyAdvance) return null;

  return (
    // Buttons are size="sm" (28px) to hold the compact row height, and this one
    // wrapper stops the click bubbling to the row's navigate-to-detail handler.
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canClear && (
        <Button size="sm" onClick={() => onClear(payment)}>
          Clear
        </Button>
      )}
      {canDishonour && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() => onDishonour(payment)}
        >
          Dishonour
        </Button>
      )}
      {canApplyAdvance && (
        <Button variant="outline" size="sm" onClick={() => onApplyAdvance(payment)}>
          Apply advance
        </Button>
      )}
    </div>
  );
}
