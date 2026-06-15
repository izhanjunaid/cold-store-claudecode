'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}
interface PL {
  revenue_lines: Line[];
  total_revenue_pkr: number;
  cost_of_service_lines: Line[];
  total_cost_of_service_pkr: number;
  gross_profit_pkr: number;
  gross_profit_pct: number;
  expense_lines: Line[];
  total_expense_pkr: number;
  net_profit_pkr: number;
  net_profit_pct: number;
}

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;

function Section({ title, lines, total }: { title: string; lines: Line[]; total: number }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {lines.length === 0 ? (
        <p className="pl-4 text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.account_code} className="flex justify-between pl-4">
              <span><span className="mr-2 font-mono text-muted-foreground">{l.account_code}</span>{l.account_name}</span>
              <span className="font-mono tabular-nums">{l.amount_pkr.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex justify-between border-t pt-2 pl-4 font-medium">
        <span>Total {title}</span>
        <span className="font-mono tabular-nums">{total.toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function ProfitLossPage() {
  const [dateFrom, setDateFrom] = useState(startOfYear());
  const [dateTo, setDateTo] = useState(today());
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<PL | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (bookType) params.set('book_type', bookType);
    apiClient<PL>(`/v1/accounting/profit-loss?${params}`).then(setData).finally(() => setLoading(false));
  }, [dateFrom, dateTo, bookType]);

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Profit & Loss"
        description="Revenue, cost of service and net profit for a period"
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
          <CardContent className="space-y-6 pt-6">
            <Section title="Revenue" lines={data.revenue_lines} total={data.total_revenue_pkr} />
            <Section title="Less: Cost of Service" lines={data.cost_of_service_lines} total={data.total_cost_of_service_pkr} />
            <div className="flex items-baseline justify-between border-t-2 pt-3 text-base font-semibold">
              <span>Gross Profit</span>
              <span className="tabular-nums">
                Rs. {data.gross_profit_pkr.toLocaleString()}
                <span className="ml-2 text-xs font-normal text-muted-foreground">({data.gross_profit_pct.toFixed(1)}%)</span>
              </span>
            </div>
            <Section title="Less: Operating Expenses" lines={data.expense_lines} total={data.total_expense_pkr} />
            <div className={cn('flex items-baseline justify-between border-t-2 pt-3 text-lg font-bold', data.net_profit_pkr >= 0 ? 'text-green-700' : 'text-destructive')}>
              <span>Net {data.net_profit_pkr >= 0 ? 'Profit' : 'Loss'}</span>
              <span className="tabular-nums">
                Rs. {data.net_profit_pkr.toLocaleString()}
                <span className="ml-2 text-sm font-normal text-muted-foreground">({data.net_profit_pct.toFixed(1)}%)</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
