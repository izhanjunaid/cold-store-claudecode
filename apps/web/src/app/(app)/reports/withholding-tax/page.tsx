'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';

interface Row {
  entry_date: string;
  entry_number: string;
  counterparty: string;
  description: string;
  withheld_pkr: number;
}

interface Section {
  section: string;
  label: string;
  account_code: string;
  opening_balance_pkr: number;
  withheld_pkr: number;
  remitted_pkr: number;
  closing_balance_pkr: number;
  rows: Row[];
}

interface Report {
  date_from: string;
  date_to: string;
  sections: Section[];
  total_withheld_pkr: number;
  total_remitted_pkr: number;
  total_outstanding_pkr: number;
}

const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function WithholdingTaxPage() {
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        (await apiClient(`/v1/reports/withholding-tax?date_from=${from}&date_to=${to}`)) as Report,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load withholding tax');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Withholding Tax"
        description="Tax deducted at source by the facility, by section — the figures behind a s.165 statement"
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="wht-from">From</Label>
            <Input id="wht-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wht-to">To</Label>
            <Input id="wht-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
          {data && (
            <div className="ml-auto flex gap-6 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Withheld</div>
                <div className="font-semibold tabular-nums">{formatMoney(data.total_withheld_pkr)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Paid over</div>
                <div className="font-semibold tabular-nums">{formatMoney(data.total_remitted_pkr)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Still held</div>
                <div className="font-semibold tabular-nums text-amber-700">
                  {formatMoney(data.total_outstanding_pkr)}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data?.sections.map((s) => (
        <Card key={s.section} className="mb-4 p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              {s.label} <span className="font-mono text-xs text-muted-foreground">{s.account_code}</span>
            </h2>
            <div className="flex gap-5 text-xs text-muted-foreground">
              <span>Opening <span className="tabular-nums">{formatMoney(s.opening_balance_pkr)}</span></span>
              <span>Withheld <span className="tabular-nums">{formatMoney(s.withheld_pkr)}</span></span>
              <span>Paid over <span className="tabular-nums">{formatMoney(s.remitted_pkr)}</span></span>
              <span className="font-medium text-foreground">
                Closing <span className="tabular-nums">{formatMoney(s.closing_balance_pkr)}</span>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Payee</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Withheld</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-xs text-muted-foreground">
                      Nothing withheld under this section in the period.
                    </TableCell>
                  </TableRow>
                )}
                {s.rows.map((r, i) => (
                  <TableRow key={`${r.entry_number}-${i}`}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.entry_date)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.entry_number}</TableCell>
                    <TableCell>{r.counterparty}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.withheld_pkr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ))}

      {data && (
        <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
          Built from the general ledger — there is no separate withholding register to fall out of
          step with it. <strong>This is not a filed return.</strong> A s.165 statement needs each
          payee&rsquo;s CNIC or NTN, which this system does not hold: expense vouchers carry a
          free-text vendor name, and payroll withholding is against staff collectively. Take the
          figures and the supporting entries to your tax advisor rather than filing from this page.
        </p>
      )}
    </div>
  );
}
