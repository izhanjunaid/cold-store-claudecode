'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface Line {
  account_code: string;
  account_name: string;
  amount_pkr: number;
}

interface BS {
  as_of_date: string;
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

const today = () => new Date().toISOString().slice(0, 10);

export default function BalanceSheetPage() {
  const [asOfDate, setAsOfDate] = useState(today());
  const [bookType, setBookType] = useState('');
  const [data, setData] = useState<BS | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ as_of_date: asOfDate });
    if (bookType) params.set('book_type', bookType);
    apiClient<BS>(`/v1/accounting/balance-sheet?${params}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [asOfDate, bookType]);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Balance Sheet</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-3">
        <label className="block">
          <span className="text-xs text-gray-500 block">As of</span>
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate((e.target as HTMLInputElement).value)} className="border rounded-lg px-3 py-2 text-sm" />
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Assets</h2>
              <Lines lines={data.asset_lines} />
              <div className="flex justify-between border-t-2 pt-2 mt-3 font-bold">
                <span>Total Assets</span>
                <span className="font-mono">{data.total_assets_pkr.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Liabilities</h2>
              <Lines lines={data.liability_lines} />
              <div className="flex justify-between border-t pt-2 mt-2 font-medium">
                <span>Total Liabilities</span>
                <span className="font-mono">{data.total_liabilities_pkr.toLocaleString()}</span>
              </div>

              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mt-6 mb-3">Equity</h2>
              <Lines lines={data.equity_lines} />
              <div className="flex justify-between text-sm pl-4 mt-1">
                <span>Current Year P&amp;L</span>
                <span className="font-mono">{data.current_year_pl_pkr.toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-t pt-2 mt-2 font-medium">
                <span>Total Equity</span>
                <span className="font-mono">{data.total_equity_pkr.toLocaleString()}</span>
              </div>

              <div className="flex justify-between border-t-2 pt-2 mt-3 font-bold">
                <span>Total Liabilities + Equity</span>
                <span className="font-mono">{data.total_liabilities_and_equity_pkr.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className={`bg-white rounded-lg shadow p-4 text-center ${data.is_balanced ? 'text-green-700' : 'text-red-700'} font-semibold`}>
            {data.is_balanced ? '✓ Balance sheet balances (Assets = Liabilities + Equity)' : '✗ UNBALANCED — investigate'}
          </div>
        </>
      )}
    </div>
  );
}

function Lines({ lines }: { lines: { account_code: string; account_name: string; amount_pkr: number }[] }) {
  if (lines.length === 0) return <p className="text-gray-400 text-sm pl-4">—</p>;
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((l) => (
        <li key={l.account_code} className="flex justify-between pl-4">
          <span><span className="font-mono text-gray-500 mr-2">{l.account_code}</span>{l.account_name}</span>
          <span className="font-mono">{l.amount_pkr.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
