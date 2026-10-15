'use client';

import { useState } from 'react';
import { PackageMinus } from 'lucide-react';
import { can } from '@/lib/permissions';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { WithdrawSheet } from './withdraw-sheet';

export interface LotWithdrawActionProps {
  lot: { id: string; lot_number: string; status: string; current_balance_bags: number };
}

/**
 * A row action: "Withdraw" opens the New Withdrawal drawer for this lot without
 * leaving the list. Shown only where a withdrawal can be booked — the user holds
 * `outbound.record` and the lot is ACTIVE with bags left — so it never offers an
 * action the server would refuse.
 *
 * `size="sm"` keeps a compact table row at its pinned height, and the wrapper stops
 * clicks (including ones from the drawer, which React bubbles through its portal)
 * from reaching the row's own navigate-to-lot handler (docs/24 §5–6).
 */
export function LotWithdrawAction({ lot }: LotWithdrawActionProps) {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  if (!can(user, 'outbound.record') || lot.status !== 'ACTIVE' || lot.current_balance_bags <= 0) return null;

  return (
    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PackageMinus className="h-3.5 w-3.5" aria-hidden />
        Withdraw
      </Button>
      <WithdrawSheet open={open} onOpenChange={setOpen} lotId={lot.id} lotNumber={lot.lot_number} />
    </div>
  );
}
