'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { OpeningBalanceNotice } from '@/components/opening-balance-notice';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Statement of changes in equity — a matrix, not a list, because that is what
 * it is: one column per category of equity, one row per kind of movement.
 *
 * IFRS for SMEs 4.13 requires an entity without share capital to show the
 * changes in each category of equity. Each equity account is a category here,
 * so a second owner's capital and drawings become columns simply by existing.
 */

interface Column {
  account_code: string;
  account_name: string;
  opening_pkr: number;
  capital_introduced_pkr: number;
  drawings_pkr: number;
  result_pkr: number;
  closing_pkr: number;
}

interface ChangesInEquity {
  date_from: string;
  date_to: string;
  columns: Column[];
  total_opening_pkr: number;
  total_capital_introduced_pkr: number;
  total_drawings_pkr: number;
  total_result_pkr: number;
  total_closing_pkr: number;
  is_reconciled: boolean;
  result_is_unallocated: boolean;
}

const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function ChangesInEquityPage() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ChangesInEquity | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        (await apiClient(
          `/v1/accounting/changes-in-equity?date_from=${from}&date_to=${to}`,
        )) as ChangesInEquity,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the statement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const Row = ({
    label,
    pick,
    total,
    emphasis,
  }: {
    label: string;
    pick: (c: Column) => number;
    total: number;
    emphasis?: boolean;
  }) => (
    <TableRow className={cn('h-7', emphasis && 'font-medium')}>
      <TableCell className="whitespace-nowrap py-1">{label}</TableCell>
      {data!.columns.map((c) => {
        const v = pick(c);
        return (
          <TableCell
            key={c.account_code}
            className={cn('py-1 text-right tabular-nums', v < 0 && 'text-destructive')}
          >
            {v === 0 ? <span className="text-muted-foreground">—</span> : formatMoney(v)}
          </TableCell>
        );
      })}
      <TableCell className={cn('py-1 text-right tabular-nums', total < 0 && 'text-destructive')}>
        {formatMoney(total)}
      </TableCell>
    </TableRow>
  );

  return (
    <div>
      <PageHeader
        title="Changes in Equity"
        description="What each owner put in, took out, and is left with"
      />

      <OpeningBalanceNotice context="statement" />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="ce-from">From</Label>
            <Input id="ce-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ce-to">To</Label>
            <Input id="ce-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
        </div>
      </Card>

      {data && !data.is_reconciled && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This statement does not reconcile: the closing figures here do not equal total equity on the
          balance sheet at the same date. Treat the figures below as unreliable and raise it.
        </p>
      )}

      <Card>
        {/* Many owners means many columns; the table scrolls rather than the page. */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="h-8">
                <TableHead className="whitespace-nowrap" />
                {data?.columns.map((c) => (
                  <TableHead key={c.account_code} className="whitespace-nowrap text-right">
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {c.account_code}
                    </span>
                    {c.account_name}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell className="text-muted-foreground">Loading…</TableCell>
                </TableRow>
              )}
              {data && !loading && data.columns.length === 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    No equity movements in this period.
                  </TableCell>
                </TableRow>
              )}
              {data && !loading && data.columns.length > 0 && (
                <>
                  <Row label="Opening balance" pick={(c) => c.opening_pkr} total={data.total_opening_pkr} />
                  <Row
                    label="Capital introduced"
                    pick={(c) => c.capital_introduced_pkr}
                    total={data.total_capital_introduced_pkr}
                  />
                  <Row label="Drawings" pick={(c) => c.drawings_pkr} total={data.total_drawings_pkr} />
                  <Row
                    label="Result for the period"
                    pick={(c) => c.result_pkr}
                    total={data.total_result_pkr}
                  />
                  <Row
                    label="Closing balance"
                    pick={(c) => c.closing_pkr}
                    total={data.total_closing_pkr}
                    emphasis
                  />
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {data && data.result_is_unallocated && data.columns.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          The result for the period is not divided between the owners. No written agreement sets a
          profit-sharing ratio, so it stays undivided in retained earnings — splitting it would put a
          figure on the statement that nothing supports. Agree a ratio with your accountant and it can
          be allocated from that date.
        </p>
      )}
    </div>
  );
}
