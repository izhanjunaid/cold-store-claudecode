'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { can } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  GrantCreditApprovalDialog,
  RevokeCreditApprovalDialog,
  type CreditApproval,
} from '@/components/party/credit-approval-dialogs';

/**
 * Standing credit on the party record: whether a truck of this party billed on credit may leave the
 * gate without a manager. Everyone sees the answer; the ceiling and the buttons belong to whoever holds
 * parties.credit_terms.
 */
export function StandingCreditCard({
  partyId,
  partyName,
  creditLimitPkr,
}: {
  partyId: string;
  partyName?: string;
  /** The party's own credit limit: a first approval starts from it. */
  creditLimitPkr?: number | null;
}) {
  const user = useAuthStore((s) => s.user);
  const canManage = can(user, 'parties.credit_terms');
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: qk.parties.creditApproval(partyId),
    queryFn: () => apiClient<CreditApproval>(`/v1/parties/${partyId}/credit-approval`),
  });

  const lapsed = !!data && !data.approved && data.id != null;

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Standing credit</CardTitle>
        {canManage && (
          <div className="flex gap-2">
            {data?.id && (
              <Button size="sm" variant="outline" onClick={() => setRevokeOpen(true)}>
                Revoke
              </Button>
            )}
            <Button size="sm" onClick={() => setGrantOpen(true)} disabled={isLoading || isError}>
              {data?.id ? 'Change' : 'Approve credit'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="text-sm">
        {isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : isError || !data ? (
          <p className="text-muted-foreground">Could not load the credit approval.</p>
        ) : data.approved ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="Credit approved" tone="success" raw />
              {data.max_outstanding_pkr != null && (
                <span className="tabular-nums">up to {formatMoney(data.max_outstanding_pkr)} owed in total</span>
              )}
              <span className="text-muted-foreground">
                {data.valid_until ? `until ${formatDate(data.valid_until)}` : 'until revoked'}
              </span>
            </div>
            {data.approved_by_name && (
              <p className="text-xs text-muted-foreground">
                Approved by {data.approved_by_name}
                {data.approved_at ? ` on ${formatDate(data.approved_at)}` : ''}
                {data.note ? ` — ${data.note}` : ''}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              A truck of this party billed on credit can leave the gate without a manager while it holds.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={lapsed ? 'Approval lapsed' : 'Not approved'} tone={lapsed ? 'warning' : 'muted'} raw />
              {lapsed && data.valid_until && (
                <span className="text-muted-foreground">ended {formatDate(data.valid_until)}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              A truck billed on credit waits for a manager at the gate.
            </p>
          </div>
        )}
      </CardContent>

      {canManage && (
        <>
          <GrantCreditApprovalDialog
            open={grantOpen}
            onOpenChange={setGrantOpen}
            partyId={partyId}
            partyName={partyName}
            current={data}
            creditLimitPkr={creditLimitPkr}
          />
          <RevokeCreditApprovalDialog open={revokeOpen} onOpenChange={setRevokeOpen} partyId={partyId} partyName={partyName} />
        </>
      )}
    </Card>
  );
}
