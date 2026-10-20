'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { formatDate, formatMoney } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CountCashDialog, type CashRow } from '@/components/dispatch/count-cash-dialog';

interface DayRow extends CashRow {
  dispatched: number;
  cash_collected_pkr: number;
  other_collected_pkr: number;
  cheques_count: number;
  cheques_pkr: number;
  credit_billed_pkr: number;
}

interface DayResponse {
  date: string;
  tracking: boolean;
  tracking_from: string | null;
  can_count: boolean;
  rows: DayRow[];
}

/**
 * The desk's money for the day, per collector: trucks, cash taken, bank transfers and wallets, cheques,
 * credit billed, and the cash still waiting to be handed over. The munshi sees their own row; a manager sees everyone's and counts
 * the cash (never their own: another manager or the owner does that).
 */
export function CashTodayCard() {
  const me = useAuthStore((s) => s.user?.id);
  const [counting, setCounting] = useState<DayRow | null>(null);

  const { data } = useQuery({
    queryKey: qk.outbound.day,
    queryFn: () => apiClient<DayResponse>('/v1/dispatch/day'),
    refetchInterval: 15_000,
  });
  if (!data || !Array.isArray(data.rows)) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Dispatch &amp; cash today <span className="ml-1 text-sm font-normal text-muted-foreground">{formatDate(data.date)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow className="h-8">
              <TableHead>Collector</TableHead>
              <TableHead className="text-right">Dispatched</TableHead>
              <TableHead className="text-right">Cash taken</TableHead>
              <TableHead className="text-right">Bank / wallet</TableHead>
              <TableHead className="text-right">Cheques</TableHead>
              <TableHead className="text-right">On credit</TableHead>
              {data.tracking && <TableHead className="text-right">Cash waiting</TableHead>}
              {data.tracking && <TableHead className="text-right"> </TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => {
              const waiting = r.pending_cash_pkr ?? 0;
              const own = r.user_id === me;
              return (
                <TableRow key={r.user_id} className="h-9">
                  <TableCell className="py-1 text-sm">
                    {r.user_name}
                    {own && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                  </TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{r.dispatched}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(r.cash_collected_pkr)}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(r.other_collected_pkr)}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">
                    {r.cheques_count > 0 ? `${r.cheques_count} · ${formatMoney(r.cheques_pkr)}` : '—'}
                  </TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(r.credit_billed_pkr)}</TableCell>
                  {data.tracking && (
                    <TableCell className="py-1 text-right tabular-nums">
                      {formatMoney(waiting)}
                      {r.pending_since && r.pending_since < data.date && (
                        <span className="block text-xs text-amber-700">since {formatDate(r.pending_since)}</span>
                      )}
                    </TableCell>
                  )}
                  {data.tracking && (
                    <TableCell className="py-1 text-right">
                      {waiting > 0 &&
                        (data.can_count && !own ? (
                          <Button size="sm" onClick={() => setCounting(r)}>
                            Count cash
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Hand it to a manager</span>
                        ))}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!data.tracking && data.can_count && (
          <p className="mt-2 text-xs text-muted-foreground">
            Cash handover is off. The owner can switch it on under Settings → Dispatch Desk Cash.
          </p>
        )}
      </CardContent>
      {counting && (
        <CountCashDialog
          open
          onOpenChange={(o) => !o && setCounting(null)}
          // Always the live row, so a refetch shows the new figure inside an open dialog.
          collector={data.rows.find((r) => r.user_id === counting.user_id) ?? counting}
        />
      )}
    </Card>
  );
}
