'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}

interface PL {
  date_from: string;
  date_to: string;
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

const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;

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
    apiClient<PL>(`/v1/accounting/profit-loss?${params}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, bookType]);

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Profit &amp; Loss</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-3">
        <label className="block">
          <span className="text-xs text-gray-500 block">From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)} className="border rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 block">To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo((e.target as HTMLInputElement).value)} className="border rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-500 block">Book</span>
          <select value={bookType} onChange={(e) => setBookType((e.target as HTMLSelectElement).value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">PACCI + KATCHI</option>
            <option value="PACCI">PACCI</option>
            <option value="KATCHI">KATCHI</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : !data ? null : (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <Section title="Revenue" lines={data.revenue_lines} total={data.total_revenue_pkr} />
          <Section title="Less: Cost of Service" lines={data.cost_of_service_lines} total={data.total_cost_of_service_pkr} />
          <SubTotal label="Gross Profit" amount={data.gross_profit_pkr} pct={data.gross_profit_pct} />
          <Section title="Less: Operating Expenses" lines={data.expense_lines} total={data.total_expense_pkr} />
          <div className={`flex justify-between items-baseline border-t-2 pt-3 text-lg font-bold ${data.net_profit_pkr >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            <span>Net {data.net_profit_pkr >= 0 ? 'Profit' : 'Loss'}</span>
            <span>
              Rs. {data.net_profit_pkr.toLocaleString()}
              <span className="ml-2 text-sm font-normal text-gray-500">({data.net_profit_pct.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, lines, total }: { title: string; lines: { account_code: string; account_name: string; amount_pkr: number }[]; total: number }) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{title}</h2>
      {lines.length === 0 ? (
        <p className="text-gray-400 text-sm pl-4">—</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.account_code} className="flex justify-between pl-4">
              <span><span className="font-mono text-gray-500 mr-2">{l.account_code}</span>{l.account_name}</span>
              <span className="font-mono">{l.amount_pkr.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-between border-t pt-2 mt-2 font-medium pl-4">
        <span>Total {title}</span>
        <span className="font-mono">{total.toLocaleString()}</span>
      </div>
    </div>
  );
}

function SubTotal({ label, amount, pct }: { label: string; amount: number; pct: number }) {
  return (
    <div className="flex justify-between items-baseline border-t-2 pt-3 font-semibold text-base">
      <span>{label}</span>
      <span>
        Rs. {amount.toLocaleString()}
        <span className="ml-2 text-xs font-normal text-gray-500">({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}
