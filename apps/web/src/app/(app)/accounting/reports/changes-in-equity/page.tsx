'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { OpeningBalanceNotice } from '@/components/opening-balance-notice';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';
import { cn } from '@/lib/utils';

/**
 * Statement of changes in equity — a matrix, not a list, because that is what
 * it is: one column per category of equity, one row per kind of movement. On the
 * statement kit like every other statement (docs/25 L-37): fiscal-year presets,
 * the book selector, print and CSV, and a period handed over by the P&L's link.
 *
 * IFRS for SMEs 4.13 requires an entity without share capital to show the
 * changes in each category of equity. Each owner's capital and drawings are
 * columns, named for the owner; the plug, retained earnings and the year's
 * result are columns by role.
 */

interface Column {
  account_code: string;
  account_name: string;
  role: string;
  partner_name: string | null;
  opening_pkr: number;
  capital_introduced_pkr: number;
  drawings_pkr: number;
  other_movements_pkr: number;
  result_pkr: number;
  transfer_pkr: number;
  closing_pkr: number;
}

interface ChangesInEquity {
  date_from: string;
  date_to: string;
  columns: Column[];
  total_opening_pkr: number;
  total_capital_introduced_pkr: number;
  total_drawings_pkr: number;
  total_other_movements_pkr: number;
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
    by_partner: { partner_id: string; partner_name: string; capital_account_code: string; amount_pkr: number }[];
    unallocated_pkr: number;
    windows: { from: string; to: string; result_pkr: number; ratio_from: string | null }[];
  } | null;
}

type RowDef = { label: string; pick: (c: Column) => number; total: (d: ChangesInEquity) => number; emphasis?: boolean; when?: (d: ChangesInEquity) => boolean };

const ROWS: RowDef[] = [
  { label: 'Opening balance', pick: (c) => c.opening_pkr, total: (d) => d.total_opening_pkr },
  { label: 'Capital introduced', pick: (c) => c.capital_introduced_pkr, total: (d) => d.total_capital_introduced_pkr },
  { label: 'Drawings', pick: (c) => c.drawings_pkr, total: (d) => d.total_drawings_pkr },
  {
    label: 'Other movements',
    pick: (c) => c.other_movements_pkr,
    total: (d) => d.total_other_movements_pkr,
    when: (d) => d.columns.some((c) => c.other_movements_pkr !== 0),
  },
  { label: 'Result for the period', pick: (c) => c.result_pkr, total: (d) => d.total_result_pkr },
  // A finished year's result moving into retained earnings; it nets to zero
  // across the two columns, so its total is 0.
  {
    label: 'Transfer to retained earnings',
    pick: (c) => c.transfer_pkr,
    total: () => 0,
    when: (d) => d.columns.some((c) => c.transfer_pkr !== 0),
  },
  { label: 'Closing balance', pick: (c) => c.closing_pkr, total: (d) => d.total_closing_pkr, emphasis: true },
];

export default function ChangesInEquityPage() {
  const search = useSearchParams();
  const linked = search?.get('date_from') && search.get('date_to')
    ? { date_from: search.get('date_from')!, date_to: search.get('date_to')!, book_type: search.get('book_type') ?? '' }
    : null;
  const { preset, setPreset, range, setCustom, bookType, setBookType } = useStatementPeriod('this_fy', linked);
  const [data, setData] = useState<ChangesInEquity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ date_from: range.date_from, date_to: range.date_to });
    if (bookType) p.set('book_type', bookType);
    apiClient<ChangesInEquity>(`/v1/accounting/changes-in-equity?${p}`)
      .then(setData)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load the statement');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [range.date_from, range.date_to, bookType]);

  const rows = data ? ROWS.filter((r) => !r.when || r.when(data)) : [];
  const heading = (c: Column) => `${c.account_code}${c.partner_name ? ` · ${c.partner_name}` : ''}`;

  function exportCsv() {
    if (!data) return;
    const csv = buildCsv(rows, [
      { header: 'Movement', value: (r) => r.label },
      ...data.columns.map((c) => ({ header: `${heading(c)} ${c.account_name}`, value: (r: RowDef) => r.pick(c) })),
      { header: 'Total', value: (r) => r.total(data) },
    ]);
    downloadCsv(`changes-in-equity-${range.date_from}_${range.date_to}`, csv);
  }

  return (
    <div>
      <PageHeader title="Changes in Equity" description="What each owner put in, took out, and is left with" />

      <OpeningBalanceNotice context="statement" />

      <StatementToolbar
        mode="range"
        preset={preset}
        onPresetChange={setPreset}
        range={range}
        onCustomChange={setCustom}
        bookType={bookType}
        onBookTypeChange={setBookType}
        compare={false}
        onCompareChange={() => undefined}
        showCompare={false}
        onPrint={() => window.print()}
        onExportCsv={exportCsv}
      />

      {data && !data.is_reconciled && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This statement does not reconcile: the closing figures here do not equal total equity on the balance
          sheet at the same date. Treat the figures below as unreliable and raise it.
        </p>
      )}

      {loading && !data ? (
        <StatementSkeleton />
      ) : !data ? null : (
        <div className="print-area space-y-4">
          <StatementFrame title="Statement of Changes in Equity" periodLabel={describePeriod(range, 'period')} bookType={bookType}>
            {/* Many owners means many columns; the table scrolls rather than the page. */}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="whitespace-nowrap" />
                    {data.columns.map((c) => (
                      <TableHead key={c.account_code} className="whitespace-nowrap text-right">
                        <span className="block text-[11px] font-normal text-muted-foreground">{heading(c)}</span>
                        {c.account_name}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.columns.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">No equity movements in this period.</TableCell>
                    </TableRow>
                  )}
                  {data.columns.length > 0 &&
                    rows.map((r) => (
                      <TableRow key={r.label} className={cn('h-7', r.emphasis && 'font-medium')}>
                        <TableCell className="whitespace-nowrap py-1">{r.label}</TableCell>
                        {data.columns.map((c) => {
                          const v = r.pick(c);
                          return (
                            <TableCell key={c.account_code} className={cn('py-1 text-right tabular-nums', v < 0 && 'text-destructive')}>
                              {v === 0 ? <span className="text-muted-foreground">—</span> : fmtAcct(v)}
                            </TableCell>
                          );
                        })}
                        <TableCell className={cn('py-1 text-right tabular-nums', r.total(data) < 0 && 'text-destructive')}>
                          {fmtAcct(r.total(data))}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </StatementFrame>

          {/* IFRS for SMEs 4.13 asks for the changes in EACH category of equity,
              and the result is the largest change of all. It is shown here rather
              than in the columns because nothing has been posted: this is what each
              owner is entitled to, not what has moved into their account. */}
          {data.result_allocation && data.result_allocation.by_partner.length > 0 && (
            <div className="rounded-lg border p-4">
              <h2 className="text-sm font-medium">Result attributable to each owner</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Their share of the period&apos;s result under the agreed ratio. It has not been transferred into their
                capital accounts — no entry is posted for it, so the columns above still show what each owner put in
                less what they took out.
              </p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {data.result_allocation.by_partner.map((p) => (
                    <tr key={p.partner_id} className="border-t">
                      <td className="py-1.5">
                        {p.partner_name} <span className="font-mono text-xs text-muted-foreground">{p.capital_account_code}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtAcct(p.amount_pkr)}</td>
                    </tr>
                  ))}
                  {data.result_allocation.unallocated_pkr !== 0 && (
                    <tr className="border-t">
                      <td className="py-1.5 text-amber-700 dark:text-amber-400">Undivided — earned before a ratio was agreed</td>
                      <td className="py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
                        {fmtAcct(data.result_allocation.unallocated_pkr)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* The second limb of 4.13: the rights attaching to each category. */}
              {data.result_allocation.windows.length > 0 && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Ratio applied:{' '}
                  {data.result_allocation.windows
                    .map((w) =>
                      w.ratio_from ? `${w.from} to ${w.to} at the ratio agreed on ${w.ratio_from}` : `${w.from} to ${w.to} with no ratio agreed`,
                    )
                    .join('; ')}
                  . Partners&apos; capital is repayable on agreement between the owners rather than on demand, which is
                  what allows it to be presented as equity rather than a liability (IFRS for SMEs 22.6).
                </p>
              )}
            </div>
          )}

          {data.result_is_unallocated && data.columns.length > 0 && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {data.result_allocation
                ? 'Part of the result was earned before any ratio took effect and stays undivided in retained earnings.'
                : 'The result for the period is not divided between the owners: no profit-sharing ratio has been agreed, and splitting it would put a figure on the statement that nothing supports. Add the owners under Accounting → Owners and set a ratio, and it is allocated from that date onward.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
