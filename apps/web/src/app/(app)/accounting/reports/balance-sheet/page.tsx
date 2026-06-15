'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}
interface BS {
  asset_lines: Line[];
  total_assets_pkr: number;
  liability_lines: Line[];
  total_liabilities_pkr: number;
  equity_lines: Line[];
  current_year_pl_pkr: number;
  total_equity_pkr: number;
  total_liabilities_and_equity_pkr: number;
  is_balanced: boolean;
}

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const today = () => new Date().toISOString().slice(0, 10);

function Lines({ lines }: { lines: Line[] }) {
  if (lines.length === 0) return <p className="pl-4 text-sm text-muted-foreground">—</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((l) => (
        <li key={l.account_code} className="flex justify-between pl-4">
          <span><span className="mr-2 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</span>
          <span className="font-mono tabular-nums">{l.amount_pkr.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

export default function BalanceSheetPage() {
  const [asOfDate, setAsOfDate] = useState(today());
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<BS | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ as_of_date: asOfDate });
    if (bookType) params.set('book_type', bookType);
    apiClient<BS>(`/v1/accounting/balance-sheet?${params}`).then(setData).finally(() => setLoading(false));
  }, [asOfDate, bookType]);

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Balance Sheet"
        description="Assets = Liabilities + Equity, as of a date"
        actions={
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">As of</Label>
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="h-9 w-auto tabular-nums" />
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
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Assets</CardTitle>
              </CardHeader>
              <CardContent>
                <Lines lines={data.asset_lines} />
                <div className="mt-3 flex justify-between border-t-2 pt-2 font-bold">
                  <span>Total Assets</span>
                  <span className="font-mono tabular-nums">{data.total_assets_pkr.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Liabilities &amp; Equity</CardTitle>
              </CardHeader>
              <CardContent>
                <Lines lines={data.liability_lines} />
                <div className="mt-2 flex justify-between border-t pt-2 font-medium">
                  <span>Total Liabilities</span>
                  <span className="font-mono tabular-nums">{data.total_liabilities_pkr.toLocaleString()}</span>
                </div>

                <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Equity</h3>
                <Lines lines={data.equity_lines} />
                <div className="mt-1 flex justify-between pl-4 text-sm">
                  <span>Current Year P&amp;L</span>
                  <span className="font-mono tabular-nums">{data.current_year_pl_pkr.toLocaleString()}</span>
                </div>
                <div className="mt-2 flex justify-between border-t pt-2 font-medium">
                  <span>Total Equity</span>
                  <span className="font-mono tabular-nums">{data.total_equity_pkr.toLocaleString()}</span>
                </div>

                <div className="mt-3 flex justify-between border-t-2 pt-2 font-bold">
                  <span>Total Liabilities + Equity</span>
                  <span className="font-mono tabular-nums">{data.total_liabilities_and_equity_pkr.toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="py-3">
              <div className={cn('flex items-center justify-center gap-1.5 text-sm font-semibold', data.is_balanced ? 'text-green-600' : 'text-destructive')}>
                {data.is_balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                {data.is_balanced ? 'Balance sheet balances (Assets = Liabilities + Equity)' : 'UNBALANCED — investigate'}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
