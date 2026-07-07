'use client';

import { useEffect, useState } from 'react';
import { Printer, Download } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { StatementFrame, StatementSkeleton } from '@/components/accounting/statement-frame';
import { describePeriod } from '@/lib/fiscal-period';
import { fmtAcct } from '@/lib/accounting-format';
import { buildCsv, downloadCsv } from '@/components/data-table/export-csv';

interface Account {
  account_code: string;
  account_name: string;
  account_type: 'HEADER' | 'DETAIL';
}
interface GLEntry {
  date: string;
  entry_number: string;
  entry_id: string;
  description: string;
  party_name: string | null;
  lot_number: string | null;
  debit_pkr: number;
  credit_pkr: number;
  balance_pkr: number;
}
interface GLResponse {
  account_code: string;
  account_name: string;
  opening_balance_pkr: number;
  total_debit_pkr: number;
  total_credit_pkr: number;
  closing_balance_pkr: number;
  entries: GLEntry[];
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function Summary({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 tabular-nums ${bold ? 'font-semibold' : ''}`}>{value}</div>
    </div>
  );
}

export default function GeneralLedgerPage() {
  const { user } = useAuthStore();
  const canSeeKatchi = hasMinRole(user?.role, 'MANAGER');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCode, setAccountCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<GLResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Initialise from URL (drill-down from a statement line) — once, on mount.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const ac = sp.get('account_code');
    if (ac) setAccountCode(ac);
    const df = sp.get('date_from');
    if (df) setDateFrom(df);
    const dt = sp.get('date_to');
    if (dt) setDateTo(dt);
    const bt = sp.get('book_type');
    if (bt) setBookType(bt);
  }, []);

  useEffect(() => {
    apiClient<Account[]>('/v1/accounting/accounts?is_active=true').then((all) => {
      const detail = all.filter((a) => a.account_type === 'DETAIL');
      setAccounts(detail);
      if (detail.length > 0) setAccountCode((prev) => prev || detail[0]!.account_code);
    });
  }, []);

  useEffect(() => {
    if (!accountCode) return;
    setLoading(true);
    const params = new URLSearchParams({ account_code: accountCode });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bookType) params.set('book_type', bookType);
    apiClient<GLResponse>(`/v1/accounting/general-ledger?${params}`).then(setData).finally(() => setLoading(false));
  }, [accountCode, dateFrom, dateTo, bookType]);

  function exportCsv() {
    if (!data) return;
    const csv = buildCsv(data.entries, [
      { header: 'Date', value: (e) => e.date },
      { header: 'Entry', value: (e) => e.entry_number },
      { header: 'Description', value: (e) => e.description },
      { header: 'Party', value: (e) => e.party_name ?? '' },
      { header: 'Lot', value: (e) => e.lot_number ?? '' },
      { header: 'Debit', value: (e) => e.debit_pkr },
      { header: 'Credit', value: (e) => e.credit_pkr },
      { header: 'Balance', value: (e) => e.balance_pkr },
    ]);
    downloadCsv(`general-ledger-${accountCode}`, csv);
  }

  const periodLabel = describePeriod({ date_from: dateFrom || undefined, date_to: dateTo || new Date().toISOString().slice(0, 10) }, 'period');

  return (
    <div>
      <PageHeader title="General Ledger" description="Every line that hit a single account" />

      <div className="print-hide mb-4 rounded-lg border bg-card p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Account</Label>
            <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className={`${SELECT_CLASS} font-mono`}>
              <option value="">Select account…</option>
              {accounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Book</Label>
            <select value={bookType} onChange={(e) => setBookType(e.target.value)} className={SELECT_CLASS}>
              <option value="">PACCI (Official)</option>
              {canSeeKatchi && <option value="KATCHI">KATCHI (Internal)</option>}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}>
              <Download className="h-4 w-4" aria-hidden />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!data}>
              <Printer className="h-4 w-4" aria-hidden />
              Print
            </Button>
          </div>
        </div>
      </div>

      {loading && !data ? (
        <StatementSkeleton />
      ) : !data ? (
        <p className="text-muted-foreground">Select an account.</p>
      ) : (
        <div className="print-area">
          <StatementFrame title={`General Ledger — ${data.account_code} ${data.account_name}`} periodLabel={periodLabel} bookType={bookType}>
            <div className="mb-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Summary label="Opening" value={fmtAcct(data.opening_balance_pkr)} />
              <Summary label="Total Debit" value={fmtAcct(data.total_debit_pkr)} />
              <Summary label="Total Credit" value={fmtAcct(data.total_credit_pkr)} />
              <Summary label="Closing" value={fmtAcct(data.closing_balance_pkr)} bold />
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Party</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="text-right">Credit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No activity</TableCell>
                  </TableRow>
                ) : (
                  data.entries.map((e) => (
                    <TableRow key={`${e.entry_id}-${e.date}-${e.entry_number}`}>
                      <TableCell className="tabular-nums">{e.date}</TableCell>
                      <TableCell className="font-mono text-xs">{e.entry_number}</TableCell>
                      <TableCell className="max-w-md truncate">{e.description}</TableCell>
                      <TableCell>{e.party_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{e.lot_number ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtAcct(e.debit_pkr)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtAcct(e.credit_pkr)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{fmtAcct(e.balance_pkr)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </StatementFrame>
        </div>
      )}
    </div>
  );
}
