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
  /**
   * Whose the period's result is — disclosed beside the columns, never inside
   * them. Nothing is posted, so no owner's account balance has moved; folding it
   * into a column would make this statement disagree with the balance sheet
   * about the same accounts. null where no ratio has ever been agreed.
   */
  result_allocation: {
    by_partner: {
      partner_id: string;
      partner_name: string;
      capital_account_code: string;
      amount_pkr: number;
    }[];
    unallocated_pkr: number;
    windows: { from: string; to: string; result_pkr: number; ratio_from: string | null }[];
  } | null;
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

      {/* IFRS for SMEs 4.13 asks for the changes in EACH category of equity, and
          the result is the largest change of all. It is shown here rather than
          in the columns because nothing has been posted: this is what each owner
          is entitled to, not what has moved into their account. */}
      {data?.result_allocation && data.result_allocation.by_partner.length > 0 && (
        <Card className="mt-4">
          <div className="p-4">
            <h2 className="text-sm font-medium">Result attributable to each owner</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Their share of the period&apos;s result under the agreed ratio. It has not been
              transferred into their capital accounts — no entry is posted for it, so the columns
              above still show what each owner put in less what they took out.
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {data.result_allocation.by_partner.map((p) => (
                  <tr key={p.partner_id} className="border-t">
                    <td className="py-1.5">
                      {p.partner_name}{' '}
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.capital_account_code}
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(p.amount_pkr)}</td>
                  </tr>
                ))}
                {data.result_allocation.unallocated_pkr !== 0 && (
                  <tr className="border-t">
                    <td className="py-1.5 text-amber-700 dark:text-amber-400">
                      Undivided — earned before a ratio was agreed
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                      {formatMoney(data.result_allocation.unallocated_pkr)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* The second limb of 4.13: the rights attaching to each category —
                which ratio applied, and over what. */}
            {data.result_allocation.windows.length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Ratio applied:{' '}
                {data.result_allocation.windows
                  .map((w) =>
                    w.ratio_from
                      ? `${w.from} to ${w.to} at the ratio agreed on ${w.ratio_from}`
                      : `${w.from} to ${w.to} with no ratio agreed`,
                  )
                  .join('; ')}
                . Partners&apos; capital is repayable on agreement between the owners rather than on
                demand, which is what allows it to be presented as equity rather than a liability
                (IFRS for SMEs 22.6).
              </p>
            )}
          </div>
        </Card>
      )}

      {data && data.result_is_unallocated && data.columns.length > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {data.result_allocation
            ? 'Part of the result was earned before any ratio took effect and stays undivided in retained earnings.'
            : 'The result for the period is not divided between the owners: no profit-sharing ratio has been agreed, and splitting it would put a figure on the statement that nothing supports. Add the owners under Accounting → Owners and set a ratio, and it is allocated from that date onward.'}
        </p>
      )}
    </div>
  );
}
