'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { ManagerAskCode } from '@coldchain/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

const LABEL: Record<ManagerAskCode, string> = {
  CALLED: 'Call a manager',
  CHEQUE_OR_TRANSFER: 'Cheque or transfer',
  CREDIT: 'Credit',
  LEAVE_CHARGE_OFF: 'Leave a charge off',
};

/** Put withdrawals on the managers' waiting list, saying what the buyer wants (docs/28 O6). */
export async function askManager(outboundIds: string[], askCode: ManagerAskCode): Promise<void> {
  await apiClient('/v1/dispatch/ask-manager', { method: 'POST', body: { outbound_ids: outboundIds, ask_code: askCode } });
}

/**
 * The call a refused checkout offers: what the munshi asked for, from the refusal's reason code.
 * `ApiError.details` is the whole error body, so the code sits one level down. Never which credit
 * rule failed: both become "the buyer wants credit".
 */
export function askForRefusal(e: unknown): ManagerAskCode | null {
  if (!(e instanceof ApiError) || e.code !== 'DISPATCH_NEEDS_MANAGER') return null;
  const reason = (e.details as { details?: { reason_code?: string } } | undefined)?.details?.reason_code;
  if (reason === 'PAYMENT_MODE') return 'CHEQUE_OR_TRANSFER';
  if (reason === 'NO_STANDING_CREDIT' || reason === 'OVER_CREDIT_CEILING') return 'CREDIT';
  if (reason === 'SKIP_CHARGE') return 'LEAVE_CHARGE_OFF';
  return 'CALLED';
}

/** One button per thing the buyer may want; nothing at all when there is no option. */
export function CallManager({
  outboundIds,
  options,
  onAsked,
}: {
  outboundIds: string[];
  options: ManagerAskCode[];
  onAsked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (options.length === 0) return null;

  async function call(code: ManagerAskCode) {
    setBusy(true);
    try {
      await askManager(outboundIds, code);
      toast.success('Sent to the managers’ list');
      onAsked();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not call a manager');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!(options.length === 1 && options[0] === 'CALLED') && (
        <span className="text-sm text-muted-foreground">Call a manager:</span>
      )}
      {options.map((code) => (
        <Button key={code} type="button" size="sm" variant="outline" disabled={busy} onClick={() => call(code)}>
          {LABEL[code]}
        </Button>
      ))}
    </div>
  );
}
