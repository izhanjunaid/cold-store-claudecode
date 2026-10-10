'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MoveRight, Rows3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLotPlacements, MoveLotDialog, EditPlacementDialog } from '@/components/lot-location';
import { qk } from '@/lib/query-keys';
import type { LotRow } from './columns';

interface LotRowActionsProps {
  lot: LotRow;
  /** Same gate as LotLocationCard's Move/Edit Placement actions on lot detail. */
  canOperate: boolean;
}

/**
 * Move / Edit Placement directly from the list — mounts the exact dialogs LotLocationCard uses
 * on lot detail, so moving stock no longer requires opening the lot first. Placements are fetched
 * on demand (only once a dialog is actually opened), not eagerly per row.
 */
export function LotRowActions({ lot, canOperate }: LotRowActionsProps) {
  const [action, setAction] = useState<'move' | 'place' | null>(null);
  const canAct = canOperate && lot.status === 'ACTIVE' && lot.current_balance_bags > 0;

  if (!canAct) return null;

  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <Button variant="ghost" size="sm" onClick={() => setAction('place')}>
        <Rows3 className="h-3.5 w-3.5" aria-hidden />
        Place
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setAction('move')}>
        <MoveRight className="h-3.5 w-3.5" aria-hidden />
        Move
      </Button>
      {action && <LotRowDialog lotId={lot.id} action={action} onClose={() => setAction(null)} />}
    </div>
  );
}

function LotRowDialog({
  lotId,
  action,
  onClose,
}: {
  lotId: string;
  action: 'move' | 'place';
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: loc } = useLotPlacements(lotId);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.lots.placements(lotId) });
    queryClient.invalidateQueries({ queryKey: qk.lots.movements(lotId) });
    queryClient.invalidateQueries({ queryKey: qk.chambers.all });
    queryClient.invalidateQueries({ queryKey: qk.lots.all });
  };

  if (!loc) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Loading…</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return action === 'move' ? (
    <MoveLotDialog loc={loc} onClose={onClose} onMoved={invalidate} />
  ) : (
    <EditPlacementDialog loc={loc} onClose={onClose} onSaved={invalidate} />
  );
}
