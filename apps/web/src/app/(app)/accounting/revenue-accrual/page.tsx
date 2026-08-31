'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface AccrualRow {
  lot_id: string;
  lot_number: string;
  party_name: string;
  commodity_name: string;
  bags: number;
  days_in_storage: number;
  revenue_account_code: string;
  accrued_to_date_pkr: number;
}

interface RunResult {
  accrued_entry_number: string | null;
  reversal_entry_number: string | null;
  total_pkr: number;
  lot_count: number;
}

interface Preview {
  period_year: number;
  period_month: number;
  period_end: string;
  lots: AccrualRow[];
  total_pkr: number;
  unaccruable: { lot_number: string; reason: string }[];
  already_run: boolean;
}

export default function RevenueAccrualPage() {
  const canPost = useCan('accounting.post_journal');
  const now = new Date();
  // Default to the month just gone: this is a period-close task, and you close
  // a period after it ends.
  const [year, setYear] = useState(now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() === 0 ? 12 : now.getUTCMonth());
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        (await apiClient(
          `/v1/accounting/revenue-accrual?period_year=${year}&period_month=${month}`,
        )) as Preview,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load accrual');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    try {
      const result = (await apiClient('/v1/accounting/revenue-accrual', {
        method: 'POST',
        body: { period_year: year, period_month: month },
      })) as RunResult;
      toast.success(
        result.accrued_entry_number
          ? `Accrued ${formatMoney(result.total_pkr)} across ${result.lot_count} lot(s) — ${result.accrued_entry_number}`
          : 'Nothing to accrue for this period',
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to post the accrual');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Storage Revenue Accrual"
        description="Recognise storage earned but not yet billed, so each period shows what it actually earned"
      />

      <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Storage is billed at withdrawal, which puts a whole season&rsquo;s revenue into one month and leaves
        every earlier period showing nothing for lots still in store. This posts what has been earned to
        date against <strong>1250 Accrued Storage Revenue</strong>, and reverses the previous period&rsquo;s
        accrual so only the difference lands in this period. When the invoice is finally raised it is
        unaffected — the accrual has already been reversed out.
        <br />
        <strong>Run this before locking the period.</strong> A period lock closes everything at or below it,
        and a locked period can never be accrued afterwards.
      </p>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="accrual-month">Period</Label>
            <select
              id="accrual-month"
              className={SELECT_CLASS}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="accrual-year">Year</Label>
            <select
              id="accrual-year"
              className={SELECT_CLASS}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {[year - 2, year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {data?.already_run && (
              <span className="text-xs text-muted-foreground">Already accrued for this period.</span>
            )}
            {canPost && (
              <Button onClick={run} disabled={running || loading || data?.already_run}>
                {running ? 'Posting…' : 'Post accrual'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {data && data.unaccruable.length > 0 && (
        <Card className="mb-4 border-amber-300 p-4 dark:border-amber-800">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            {data.unaccruable.length} lot(s) cannot be accrued
          </div>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.unaccruable.map((u) => (
              <li key={u.lot_number}>
                <strong>{u.lot_number}</strong> — {u.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            These are excluded rather than guessed at. A seasonal fee with no season end date has no term
            to spread across, and inventing one would put a made-up figure on the face of the P&amp;L.
          </p>
        </Card>
      )}

      <Card>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow className="h-8 hover:bg-transparent">
              <TableHead className="h-8">Lot</TableHead>
              <TableHead className="h-8">Party</TableHead>
              <TableHead className="h-8">Commodity</TableHead>
              <TableHead className="h-8 text-right">Bags</TableHead>
              <TableHead className="h-8 text-right">Days</TableHead>
              <TableHead className="h-8">Revenue account</TableHead>
              <TableHead className="h-8 text-right">Earned to date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!loading && data?.lots.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  No lots were in storage during this period.
                </TableCell>
              </TableRow>
            )}
            {data?.lots.map((l) => (
              <TableRow key={l.lot_id} className="h-7">
                <TableCell className="py-1 font-medium">{l.lot_number}</TableCell>
                <TableCell className="py-1">{l.party_name}</TableCell>
                <TableCell className="py-1">{l.commodity_name}</TableCell>
                <TableCell className="py-1 text-right">{l.bags}</TableCell>
                <TableCell className="py-1 text-right">{l.days_in_storage}</TableCell>
                <TableCell className="py-1 text-xs text-muted-foreground">{l.revenue_account_code}</TableCell>
                <TableCell className="py-1 text-right">{formatMoney(l.accrued_to_date_pkr)}</TableCell>
              </TableRow>
            ))}
            {data && data.lots.length > 0 && (
              <TableRow className="h-7 font-medium">
                <TableCell className="py-1" colSpan={6}>Total accrued to {data.period_end}</TableCell>
                <TableCell className="py-1 text-right">{formatMoney(data.total_pkr)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
