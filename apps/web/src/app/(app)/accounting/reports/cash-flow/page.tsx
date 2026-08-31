'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { OpeningBalanceNotice } from '@/components/opening-balance-notice';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}

interface CashFlow {
  date_from: string;
  date_to: string;
  operating_lines: Line[];
  total_operating_pkr: number;
  investing_lines: Line[];
  total_investing_pkr: number;
  financing_lines: Line[];
  total_financing_pkr: number;
  net_change_pkr: number;
  opening_cash_pkr: number;
  closing_cash_pkr: number;
  cash_composition: Line[];
  cheques_in_hand_pkr: number;
  is_reconciled: boolean;
}

const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function CashFlowPage() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData((await apiClient(`/v1/accounting/cash-flow?date_from=${from}&date_to=${to}`)) as CashFlow);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the cash flow statement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const Section = ({ title, lines, total }: { title: string; lines: Line[]; total: number }) => (
    <>
      <TableRow className="h-7 bg-muted/50">
        <TableCell colSpan={2} className="py-1 text-xs font-semibold uppercase tracking-wide">{title}</TableCell>
      </TableRow>
      {lines.length === 0 && (
        <TableRow className="h-7">
          <TableCell colSpan={2} className="py-1 pl-6 text-xs text-muted-foreground">No movements in this period.</TableCell>
        </TableRow>
      )}
      {lines.map((l) => (
        <TableRow key={`${title}-${l.account_code}`} className="h-7">
          <TableCell className="py-1 pl-6">
            <span className="text-xs text-muted-foreground">{l.account_code}</span> {l.account_name}
          </TableCell>
          <TableCell className={cn('py-1 text-right tabular-nums', l.amount_pkr < 0 && 'text-destructive')}>
            {formatMoney(l.amount_pkr)}
          </TableCell>
        </TableRow>
      ))}
      <TableRow className="h-7 font-medium">
        <TableCell className="py-1">Net cash from {title.toLowerCase()}</TableCell>
        <TableCell className={cn('py-1 text-right tabular-nums', total < 0 && 'text-destructive')}>
          {formatMoney(total)}
        </TableCell>
      </TableRow>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Cash Flow"
        description="Statement of cash flows — where the money actually came from and went"
      />

      <OpeningBalanceNotice context="statement" />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="cf-from">From</Label>
            <Input id="cf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-to">To</Label>
            <Input id="cf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
        </div>
      </Card>

      {data && !data.is_reconciled && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This statement does not reconcile: opening cash plus the net change does not equal closing cash.
          Treat the figures below as unreliable and raise it — the statement says so rather than presenting
          a total it cannot stand behind.
        </p>
      )}

      <Card>
        <Table>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={2} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {data && !loading && (
              <>
                <Section title="Operating activities" lines={data.operating_lines} total={data.total_operating_pkr} />
                <Section title="Investing activities" lines={data.investing_lines} total={data.total_investing_pkr} />
                <Section title="Financing activities" lines={data.financing_lines} total={data.total_financing_pkr} />

                <TableRow className="h-7 border-t-2 font-semibold">
                  <TableCell className="py-1">Net change in cash</TableCell>
                  <TableCell className={cn('py-1 text-right tabular-nums', data.net_change_pkr < 0 && 'text-destructive')}>
                    {formatMoney(data.net_change_pkr)}
                  </TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1">Cash and cash equivalents, opening</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.opening_cash_pkr)}</TableCell>
                </TableRow>
                <TableRow className="h-7 font-semibold">
                  <TableCell className="py-1">Cash and cash equivalents, closing</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.closing_cash_pkr)}</TableCell>
                </TableRow>

                <TableRow className="h-7 bg-muted/50">
                  <TableCell colSpan={2} className="py-1 text-xs font-semibold uppercase tracking-wide">
                    Composition of cash and cash equivalents
                  </TableCell>
                </TableRow>
                {data.cash_composition.map((l) => (
                  <TableRow key={`comp-${l.account_code}`} className="h-7">
                    <TableCell className="py-1 pl-6">
                      <span className="text-xs text-muted-foreground">{l.account_code}</span> {l.account_name}
                    </TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{formatMoney(l.amount_pkr)}</TableCell>
                  </TableRow>
                ))}
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      {data && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Prepared on the direct method. <strong>Cheques in hand ({formatMoney(data.cheques_in_hand_pkr)})</strong>{' '}
          are excluded from cash and cash equivalents: a received cheque can still bounce, so it becomes cash
          only when it clears. Transfers between your own cash and bank accounts are not shown — they move
          money between pockets without changing how much there is.
        </p>
      )}
    </div>
  );
}
