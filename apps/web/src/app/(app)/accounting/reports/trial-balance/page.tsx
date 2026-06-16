'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { PageHeader } from '@/components/layout/page-header';
import { StatementFrame } from '@/components/accounting/statement-frame';
import { StatementToolbar } from '@/components/accounting/statement-toolbar';
import { useStatementPeriod } from '@/components/accounting/use-statement-period';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';
import { cn } from '@/lib/utils';

interface Row {
  account_code: string;
  account_name: string;
  account_class: string;
  normal_balance: string;
  opening_debit_pkr: number;
  opening_credit_pkr: number;
  movement_debit_pkr: number;
  movement_credit_pkr: number;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}
interface Subtotal {
  opening_debit_pkr: number;
  opening_credit_pkr: number;
  movement_debit_pkr: number;
  movement_credit_pkr: number;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}
interface Group {
  account_class: string;
  label: string;
  rows: Row[];
  subtotal: Subtotal;
}
interface TB {
  date_from: string | null;
  date_to: string;
  groups: Group[];
  rows: Row[];
  total_opening_debit_pkr: number;
  total_opening_credit_pkr: number;
  total_movement_debit_pkr: number;
  total_movement_credit_pkr: number;
  total_debit_pkr: number;
  total_credit_pkr: number;
  is_balanced: boolean;
}

const numCls = 'px-2 py-1 text-right tabular-nums';
const headCls = 'px-2 py-1 text-right font-medium';

export default function TrialBalancePage() {
  const { preset, setPreset, range, setCustom, bookType, setBookType, compare, setCompare } = useStatementPeriod('this_fy');
  const [data, setData] = useState<TB | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams({ date_from: range.date_from, date_to: range.date_to });
    if (bookType) p.set('book_type', bookType);
    apiClient<TB>(`/v1/accounting/trial-balance?${p}`).then(setData).finally(() => setLoading(false));
  }, [range.date_from, range.date_to, bookType]);

  const glHref = (code: string) =>
    `/accounting/general-ledger?account_code=${code}&date_from=${range.date_from}&date_to=${range.date_to}${bookType ? `&book_type=${bookType}` : ''}`;

  function exportCsv() {
    if (!data) return;
    const csv = buildCsv(
      data.rows,
      [
        { header: 'Class', value: (r) => r.account_class },
        { header: 'Code', value: (r) => r.account_code },
        { header: 'Account', value: (r) => r.account_name },
        { header: 'Opening Dr', value: (r) => r.opening_debit_pkr },
        { header: 'Opening Cr', value: (r) => r.opening_credit_pkr },
        { header: 'Movement Dr', value: (r) => r.movement_debit_pkr },
        { header: 'Movement Cr', value: (r) => r.movement_credit_pkr },
        { header: 'Closing Dr', value: (r) => r.debit_balance_pkr },
        { header: 'Closing Cr', value: (r) => r.credit_balance_pkr },
      ],
    );
    downloadCsv(`trial-balance-${range.date_from}_${range.date_to}`, csv);
  }

  return (
    <div>
      <PageHeader title="Trial Balance" description="Opening · movement · closing balances across all accounts" />

      <StatementToolbar
        mode="range"
        preset={preset}
        onPresetChange={setPreset}
        range={range}
        onCustomChange={setCustom}
        bookType={bookType}
        onBookTypeChange={setBookType}
        compare={compare}
        onCompareChange={setCompare}
        showCompare={false}
        onPrint={() => window.print()}
        onExportCsv={exportCsv}
      />

      {loading && !data ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data ? null : (
        <div className="print-area">
          <StatementFrame title="Trial Balance" periodLabel={describePeriod({ date_from: range.date_from, date_to: range.date_to }, 'period')} bookType={bookType}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Account</th>
                    <th className={headCls} colSpan={2}>Opening</th>
                    <th className={headCls} colSpan={2}>Movement</th>
                    <th className={headCls} colSpan={2}>Closing</th>
                  </tr>
                  <tr className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium" />
                    <th className={headCls}>Dr</th>
                    <th className={headCls}>Cr</th>
                    <th className={headCls}>Dr</th>
                    <th className={headCls}>Cr</th>
                    <th className={headCls}>Dr</th>
                    <th className={headCls}>Cr</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <Fragment key={g.account_class}>
                      <tr>
                        <td colSpan={7} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</td>
                      </tr>
                      {g.rows.map((r) => (
                        <tr key={r.account_code} className="hover:bg-muted/40">
                          <td className="px-2 py-1">
                            <Link href={glHref(r.account_code)} className="hover:text-primary hover:underline">
                              <span className="mr-2 font-mono text-xs text-muted-foreground">{r.account_code}</span>
                              {r.account_name}
                            </Link>
                          </td>
                          <td className={numCls}>{fmtAcct(r.opening_debit_pkr)}</td>
                          <td className={numCls}>{fmtAcct(r.opening_credit_pkr)}</td>
                          <td className={numCls}>{fmtAcct(r.movement_debit_pkr)}</td>
                          <td className={numCls}>{fmtAcct(r.movement_credit_pkr)}</td>
                          <td className={numCls}>{fmtAcct(r.debit_balance_pkr)}</td>
                          <td className={numCls}>{fmtAcct(r.credit_balance_pkr)}</td>
                        </tr>
                      ))}
                      <tr className="border-t font-semibold">
                        <td className="px-2 py-1">Total {g.label}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.opening_debit_pkr)}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.opening_credit_pkr)}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.movement_debit_pkr)}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.movement_credit_pkr)}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.debit_balance_pkr)}</td>
                        <td className={numCls}>{fmtAcct(g.subtotal.credit_balance_pkr)}</td>
                      </tr>
                    </Fragment>
                  ))}
                  <tr className="border-t-4 border-double border-foreground/70 font-bold">
                    <td className="px-2 py-1.5">Grand Total</td>
                    <td className={numCls}>{fmtAcct(data.total_opening_debit_pkr)}</td>
                    <td className={numCls}>{fmtAcct(data.total_opening_credit_pkr)}</td>
                    <td className={numCls}>{fmtAcct(data.total_movement_debit_pkr)}</td>
                    <td className={numCls}>{fmtAcct(data.total_movement_credit_pkr)}</td>
                    <td className={numCls}>{fmtAcct(data.total_debit_pkr)}</td>
                    <td className={numCls}>{fmtAcct(data.total_credit_pkr)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={cn('mt-4 flex items-center justify-center gap-1.5 text-sm font-medium', data.is_balanced ? 'text-green-600' : 'text-destructive')}>
              {data.is_balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
              {data.is_balanced ? 'Trial balance balanced (total Dr = total Cr)' : 'UNBALANCED — investigate immediately'}
            </div>
          </StatementFrame>
        </div>
      )}
    </div>
  );
}
