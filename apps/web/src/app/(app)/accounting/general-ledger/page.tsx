'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

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
      <div className={`mt-0.5 font-mono tabular-nums ${bold ? 'font-semibold' : ''}`}>{value}</div>
    </div>
  );
}

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountCode, setAccountCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<GLResponse | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <div>
      <PageHeader title="General Ledger" description="Every line that hit a single account" />

      <Card className="mb-4">
        <CardContent className="grid grid-cols-1 gap-3 pt-6 md:grid-cols-4">
          <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className={`${SELECT_CLASS} font-mono`}>
            <option value="">Select account…</option>
            {accounts.map((a) => (
              <option key={a.account_code} value={a.account_code}>
                {a.account_code} — {a.account_name}
              </option>
            ))}
          </select>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="tabular-nums" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="tabular-nums" />
          <select value={bookType} onChange={(e) => setBookType(e.target.value)} className={SELECT_CLASS}>
            <option value="">PACCI + KATCHI</option>
            <option value="PACCI">PACCI</option>
            <option value="KATCHI">KATCHI</option>
          </select>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data ? (
        <p className="text-muted-foreground">Select an account.</p>
      ) : (
        <>
          <Card className="mb-4">
            <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm md:grid-cols-5">
              <Summary label="Account" value={`${data.account_code} — ${data.account_name}`} bold />
              <Summary label="Opening" value={data.opening_balance_pkr.toLocaleString()} />
              <Summary label="Total Debit" value={data.total_debit_pkr.toLocaleString()} />
              <Summary label="Total Credit" value={data.total_credit_pkr.toLocaleString()} />
              <Summary label="Closing" value={data.closing_balance_pkr.toLocaleString()} bold />
            </CardContent>
          </Card>

          <Card>
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
                      <TableCell>{e.date}</TableCell>
                      <TableCell className="font-mono text-xs">{e.entry_number}</TableCell>
                      <TableCell className="max-w-md truncate">{e.description}</TableCell>
                      <TableCell>{e.party_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{e.lot_number ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.debit_pkr > 0 ? e.debit_pkr.toLocaleString() : ''}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.credit_pkr > 0 ? e.credit_pkr.toLocaleString() : ''}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{e.balance_pkr.toLocaleString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
