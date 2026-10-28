'use client';

import { useRouter } from 'next/navigation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WithdrawForm } from './withdraw-form';

export interface WithdrawSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lot to withdraw from; the form loads it itself. */
  lotId: string;
  lotNumber?: string;
  /** Trucks inside, offered as one-tap plates in the form. */
  plateSuggestions?: string[];
  /** Book onto this truck: the plate is filled in and fixed. */
  fixedPlate?: string;
  /** Called after booking instead of opening the withdrawal's page (the dispatch desk stays put). */
  onBooked?: (outboundId: string) => void;
}

/**
 * Book a withdrawal without leaving the list, the lot or the party record — a
 * drawer rather than a modal per docs/24_ui_density_spec.md §5 (a form of ~7 fields
 * plus a lot summary). `/lots/[id]/withdraw` stays as the full-page deep link and
 * shares this exact form.
 *
 * After booking it goes to the withdrawal's page: weighing still happens there
 * until the dispatch desk replaces that step.
 */
export function WithdrawSheet({ open, onOpenChange, lotId, lotNumber, plateSuggestions, fixedPlate, onBooked }: WithdrawSheetProps) {
  const router = useRouter();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>{lotNumber ? `New Withdrawal — ${lotNumber}` : 'New Withdrawal'}</SheetTitle>
          <SheetDescription className="sr-only">Book a withdrawal of stored bags from this lot.</SheetDescription>
        </SheetHeader>
        {open && (
          <WithdrawForm
            key={lotId}
            lotId={lotId}
            variant="sheet"
            plateSuggestions={plateSuggestions}
            fixedPlate={fixedPlate}
            onCreated={(id) => {
              onOpenChange(false);
              if (onBooked) onBooked(id);
              else router.push(`/outbound-events/${id}`);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
