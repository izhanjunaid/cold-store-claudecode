'use client';

import { Button } from '@/components/ui/button';
import type { PaymentRow } from './columns';

interface PaymentRowActionsProps {
  payment: PaymentRow;
  /** `payments.record` — the same key the API enforces on all three endpoints. */
  canRecord: boolean;
  onClear: (payment: PaymentRow) => void;
  onDishonour: (payment: PaymentRow) => void;
  onAllocate: (payment: PaymentRow) => void;
}

/**
 * Cheque clearing, dishonour and applying a receipt to invoices, from the list row —
 * none of the three needs the detail page (spec §5: a single POST or a small
 * dialog belongs on the list). `/payments/[id]` stays as the bookmarkable
 * fallback and shares the same dialogs.
 */
export function PaymentRowActions({
  payment,
  canRecord,
  onClear,
  onDishonour,
  onAllocate,
}: PaymentRowActionsProps) {
  // Which actions a receipt allows is the server's call (docs/25 R-37); the page
  // only checks the user may take them.
  const canClear = canRecord && payment.can_clear;
  const canDishonour = canRecord && payment.can_dishonour;
  const canAllocate = canRecord && payment.can_allocate;

  if (!canClear && !canDishonour && !canAllocate) return null;

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
      {canAllocate && (
        <Button variant="outline" size="sm" onClick={() => onAllocate(payment)}>
          {payment.is_advance ? 'Apply advance' : 'Apply to invoices'}
        </Button>
      )}
    </div>
  );
}
