'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const BANK_ACCOUNTS = [
  { code: '1020', label: '1020 — Bank Account (Main)' },
  { code: '1010', label: '1010 — Cash on Hand' },
  { code: '1030', label: '1030 — Mobile Wallet' },
];

interface Preview {
  period_year: number;
  period_month: number;
  period_end: string;
  period_output_tax_pkr: number;
  period_input_tax_pkr: number;
  outstanding_output_tax_pkr: number;
  available_input_tax_pkr: number;
  input_tax_applied_pkr: number;
  net_payable_pkr: number;
  includes_earlier_periods: boolean;
}

interface SettlementResult {
  entry_number: string;
  output_tax_pkr: number;
  net_remitted_pkr: number;
}

export default function GstSettlementPage() {
  const canPost = useCan('accounting.post_journal');
  const now = new Date();
  // A return is filed after its period ends, so default to the month just gone.
  const [year, setYear] = useState(now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() === 0 ? 12 : now.getUTCMonth());
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [bankAccount, setBankAccount] = useState('1020');
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        (await apiClient(
          `/v1/accounting/gst-settlement?period_year=${year}&period_month=${month}`,
        )) as Preview,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the sales tax position');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = async () => {
    setPosting(true);
    try {
      const result = (await apiClient('/v1/accounting/gst-settlement', {
        method: 'POST',
        body: {
          period_year: year,
          period_month: month,
          payment_date: paymentDate,
          bank_account_code: bankAccount,
        },
      })) as SettlementResult;
      toast.success(
        `Settled ${formatMoney(result.output_tax_pkr)} of output tax — ${result.entry_number}`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to post the settlement');
    } finally {
      setPosting(false);
    }
  };

  const nothingOwed = !!data && data.outstanding_output_tax_pkr <= 0;

  return (
    <div>
      <PageHeader
        title="Sales Tax Settlement"
        description="Clear the GST collected on invoices against input tax and the amount remitted"
      />

      <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Every finalised invoice credits <strong>2020 GST Payable</strong>. Until the return is filed
        and recorded here, nothing ever debits it, so the balance sheet overstates the liability by
        every rupee of tax already paid over. This posts that missing debit.
        <br />
        The entry is dated on the <strong>payment date</strong>, not the period end — the tax is owed
        at the period end but remitted weeks later, and dating it earlier would understate the
        liability on the very balance sheet the return is prepared from.
      </p>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="gst-month">Tax period</Label>
            <select id="gst-month" className={SELECT_CLASS} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gst-year">Year</Label>
            <select id="gst-year" className={SELECT_CLASS} value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gst-paid-on">Paid on</Label>
            <Input
              id="gst-paid-on"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gst-bank">Paid from</Label>
            <select id="gst-bank" className={SELECT_CLASS} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}>
              {BANK_ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {nothingOwed && <span className="text-xs text-muted-foreground">Nothing outstanding for this period.</span>}
            {canPost && (
              <Button onClick={settle} disabled={posting || loading || nothingOwed}>
                {posting ? 'Posting…' : 'Record settlement'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {data?.includes_earlier_periods && (
        <Card className="mb-4 border-amber-300 p-4 dark:border-amber-800">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            This settlement also clears tax from earlier periods
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The outstanding amount is larger than this period&rsquo;s own output tax, which means an
            earlier return was never recorded here. Settling now clears both together.
          </p>
        </Card>
      )}

      <Card>
        <Table>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={2} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {data && !loading && (
              <>
                <TableRow className="h-7 bg-muted/50">
                  <TableCell colSpan={2} className="py-1 text-xs font-semibold uppercase tracking-wide">
                    This period ({data.period_end})
                  </TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1 pl-6">Output tax charged on invoices</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.period_output_tax_pkr)}</TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1 pl-6">Input tax incurred</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.period_input_tax_pkr)}</TableCell>
                </TableRow>

                <TableRow className="h-7 bg-muted/50">
                  <TableCell colSpan={2} className="py-1 text-xs font-semibold uppercase tracking-wide">
                    To be settled
                  </TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1 pl-6">Output tax outstanding (2020)</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.outstanding_output_tax_pkr)}</TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1 pl-6">Input tax available (1260)</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.available_input_tax_pkr)}</TableCell>
                </TableRow>
                <TableRow className="h-7">
                  <TableCell className="py-1 pl-6">Input tax applied</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.input_tax_applied_pkr)}</TableCell>
                </TableRow>
                <TableRow className="h-7 border-t-2 font-semibold">
                  <TableCell className="py-1">Net payable</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{formatMoney(data.net_payable_pkr)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      {data && data.available_input_tax_pkr > data.input_tax_applied_pkr && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Input tax of {formatMoney(data.available_input_tax_pkr - data.input_tax_applied_pkr)} exceeds
          the output tax and stays in 1260 to carry forward. It is an adjustable credit against future
          output tax, not a refund receivable, so it is not claimed here.
        </p>
      )}
    </div>
  );
}
