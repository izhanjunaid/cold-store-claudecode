'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_FY_START_MONTH, fiscalYearStart, toIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useFacility } from '@/hooks/use-reference-data';
import { qk } from '@/lib/query-keys';
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

interface Preview {
  period_year: number;
  period_month: number;
  period_end: string;
  /** Accrual applies from this date; null until the facility sets one. */
  start_date: string | null;
  lots: AccrualRow[];
  total_pkr: number;
  unaccruable: { lot_number: string; reason: string }[];
  already_run: boolean;
}

export default function RevenueAccrualPage() {
  const now = new Date();
  // Default to the month just gone: this is a period-close task, and you close
  // a period after it ends.
  const [year, setYear] = useState(now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() === 0 ? 12 : now.getUTCMonth());
  const [data, setData] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);

  // The start is a fiscal-year boundary in an open period (docs/25 Q2); the server
  // enforces both, this only offers the boundaries around today.
  const { user } = useAuthStore();
  const canSetStart = can(user, 'settings.manage');
  const facility = useFacility();
  const queryClient = useQueryClient();
  const fyMonth = facility.data?.settings?.fiscal_year_start_month ?? DEFAULT_FY_START_MONTH;
  const thisFyStart = fiscalYearStart(now, fyMonth);
  const fyStarts = [-1, 0, 1].map((k) =>
    toIsoDate(new Date(Date.UTC(thisFyStart.getUTCFullYear() + k, thisFyStart.getUTCMonth(), 1))),
  );
  const [newStart, setNewStart] = useState(fyStarts[1]!);
  const [saving, setSaving] = useState(false);

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

  async function saveStart() {
    setSaving(true);
    try {
      await apiClient('/v1/facilities/me', {
        method: 'PATCH',
        body: { settings: { revenue_accrual: { start_date: newStart } } },
      });
      toast.success(`Storage revenue is accrued from ${newStart}`);
      await queryClient.invalidateQueries({ queryKey: qk.facility.me });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not set the start date');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Storage Revenue Accrual"
        description="Storage earned but not yet billed — what each month's close will accrue"
      />

      <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Storage revenue is recognised month by month as it is earned. When a month is closed on the{' '}
        <Link href="/accounting/period-locks" className="underline">period locks</Link> page, the storage
        earned and not yet billed is accrued, and reversed again on the first of the next month — so each
        month keeps exactly what it earned and the invoice that eventually bills the storage carries the
        revenue. A month with draft invoices dated in it cannot be closed until they are finalised.
        {data && (
          <>
            <br />
            {data.start_date ? (
              <>Accrual applies from <strong>{data.start_date}</strong>; months before it close without one.</>
            ) : (
              <strong>No accrual start date is set yet, so months close without an accrual.</strong>
            )}
          </>
        )}
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
          {canSetStart && data && (
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="accrual-start">Accrue from</Label>
                <select
                  id="accrual-start"
                  className={SELECT_CLASS}
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                >
                  {fyStarts.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <Button size="sm" disabled={saving || newStart === data.start_date} onClick={() => void saveStart()}>
                Set start
              </Button>
            </div>
          )}
          <div className="ml-auto flex items-center gap-3">
            {data?.already_run && (
              <span className="text-xs text-muted-foreground">Accrued when this month was closed.</span>
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
