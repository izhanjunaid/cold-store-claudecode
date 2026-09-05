'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { PaymentForm } from '@/app/(app)/payments/payment-form';

export interface RecordPaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to let the drawer pick the party (the payments-list case). */
  partyId?: string;
  partyName?: string;
  /** Pre-fills a single allocation at this invoice's full balance. */
  invoiceId?: string;
  invoiceNumber?: string | null;
  invoiceBalance?: number;
  onSuccess?: () => void;
}

/**
 * Record a payment without leaving the list, the invoice, or the party record.
 * A drawer rather than a modal per docs/24_ui_density_spec.md §5: the form runs
 * to ~10 fields plus an allocations table, which is the Sheet band (5–15), and
 * keeping the row behind it visible is the point.
 *
 * `/payments/new` stays as the full-page deep-link target and shares this exact
 * form, so there is one payment form, not two.
 */
export function RecordPaymentSheet({
  open,
  onOpenChange,
  partyId,
  partyName,
  invoiceId,
  invoiceNumber,
  invoiceBalance,
  onSuccess,
}: RecordPaymentSheetProps) {
  const title = invoiceNumber
    ? `Record Payment — ${invoiceNumber}`
    : partyName
      ? `Record Payment — ${partyName}`
      : 'Record Payment';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {/* No SheetBody: the form owns the scroll region itself so its submit
            row can stay pinned below the fields (variant="sheet"). */}
        {open && (
          <PaymentForm
            key={`${partyId ?? 'any'}:${invoiceId ?? 'none'}`}
            defaultPartyId={partyId ?? ''}
            lockPartyId={!!partyId}
            partyName={partyName}
            defaultInvoiceId={invoiceId}
            defaultInvoiceBalance={invoiceBalance}
            columns={3}
            variant="sheet"
            onCreated={() => {
              onOpenChange(false);
              onSuccess?.();
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
