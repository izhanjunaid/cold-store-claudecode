import { useQuery } from '@tanstack/react-query';
import type { ManagerAllowCode, ManagerAskCode, ManagerReasonCode } from '@coldchain/shared';
import { apiClientList } from '@/lib/api-client';
import { can } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/auth.store';

/** One withdrawal on the managers' waiting list (GET /v1/dispatch/waiting). */
export interface WaitingRow {
  id: string;
  dispatch_note_number: string | null;
  lot_id: string;
  lot_number: string;
  marka: string | null;
  owner_party_name: string | null;
  quantity_withdrawn_bags: number;
  vehicle_number: string | null;
  outbound_date: string;
  created_at: string;
  created_by_name: string;
  /** Why the munshi may not finish it alone (the solo rules), or null. */
  reason_code: ManagerReasonCode | null;
  /** What a munshi called a manager for, and when. */
  ask_code: ManagerAskCode | null;
  asked_at: string | null;
  /** What a manager has allowed today (docs/28 O8-O10), who, and when: the desk can finish these. */
  allows: ManagerAllowCode[];
  allowed_by_name: string | null;
  allowed_at: string | null;
}

/**
 * What waits for a manager (docs/28 D6): read only by those who can finish it — the manager keys —
 * so the sidebar of a munshi or a guard never asks. The desk's card and the sidebar's count share it.
 */
export function useWaitingForManager(): { rows: WaitingRow[]; total: number; listed: number } {
  const user = useAuthStore((s) => s.user);
  const enabled = !!user && can(user, 'outbound.finalize') && can(user, 'invoices.manage');
  const { data } = useQuery({
    queryKey: qk.outbound.waiting,
    queryFn: () => apiClientList<WaitingRow>('/v1/dispatch/waiting'),
    enabled,
    refetchInterval: 30_000,
  });
  if (!enabled) return { rows: [], total: 0, listed: 0 };
  // `total` is what still needs a manager (the badge); `listed` is every row on the list, the allowed ones included.
  const rows = data?.data ?? [];
  return { rows, total: data?.meta?.total ?? 0, listed: (data?.meta as { listed?: number } | undefined)?.listed ?? rows.length };
}
