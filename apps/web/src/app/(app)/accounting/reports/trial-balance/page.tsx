'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

interface Row {
  account_code: string;
  account_name: string;
  account_class: string;
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}
interface TB {
  rows: Row[];
  total_debit_pkr: number;
  total_credit_pkr: number;
  is_balanced: boolean;
}

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const today = () => new Date().toISOString().slice(0, 10);

export default function TrialBalancePage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(today());
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<TB | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bookType) params.set('book_type', bookType);
    apiClient<TB>(`/v1/accounting/trial-balance?${params}`).then(setData).finally(() => setLoading(false));
  }, [dateFrom, dateTo, bookType]);

  return (
    <div>
      <PageHeader
        title="Trial Balance"
        description="Debits = credits across all accounts"
        actions={
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-auto tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-auto tabular-nums" />
            </div>
            <select value={bookType} onChange={(e) => setBookType(e.target.value)} className={SELECT_CLASS}>
              <option value="">PACCI + KATCHI</option>
              <option value="PACCI">PACCI</option>
              <option value="KATCHI">KATCHI</option>
            </select>
          </div>
        }
      />

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !data ? null : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No activity in this period</TableCell>
                </TableRow>
              ) : (
                data.rows.map((r) => (
                  <TableRow key={r.account_code}>
                    <TableCell className="font-mono">{r.account_code}</TableCell>
                    <TableCell>{r.account_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.account_class}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.debit_balance_pkr > 0 ? r.debit_balance_pkr.toLocaleString() : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.credit_balance_pkr > 0 ? r.credit_balance_pkr.toLocaleString() : ''}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">Totals</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{data.total_debit_pkr.toLocaleString()}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{data.total_credit_pkr.toLocaleString()}</TableCell>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="text-right">
                  <span className={`inline-flex items-center gap-1.5 ${data.is_balanced ? 'text-green-600' : 'text-destructive'}`}>
                    {data.is_balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                    {data.is_balanced ? 'Trial balance balanced' : 'UNBALANCED — investigate immediately'}
                  </span>
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      )}
    </div>
  );
}
