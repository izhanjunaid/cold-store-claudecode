import { useQuery } from '@tanstack/react-query';
import type { ManagerAskCode, ManagerReasonCode } from '@coldchain/shared';
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
}

/**
 * What waits for a manager (docs/28 D6): read only by those who can finish it — the manager keys —
 * so the sidebar of a munshi or a guard never asks. The desk's card and the sidebar's count share it.
 */
export function useWaitingForManager(): { rows: WaitingRow[]; total: number } {
  const user = useAuthStore((s) => s.user);
  const enabled = !!user && can(user, 'outbound.finalize') && can(user, 'invoices.manage');
  const { data } = useQuery({
    queryKey: qk.outbound.waiting,
    queryFn: () => apiClientList<WaitingRow>('/v1/dispatch/waiting'),
    enabled,
    refetchInterval: 30_000,
  });
  if (!enabled) return { rows: [], total: 0 };
  return { rows: data?.data ?? [], total: data?.meta?.total ?? 0 };
}
