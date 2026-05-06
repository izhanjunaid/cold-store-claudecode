'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface Row {
  account_code: string;
  account_name: string;
  account_class: string;
  normal_balance: 'DEBIT' | 'CREDIT';
  debit_balance_pkr: number;
  credit_balance_pkr: number;
}

interface TB {
  date_from: string | null;
  date_to: string;
  rows: Row[];
  total_debit_pkr: number;
  total_credit_pkr: number;
  is_balanced: boolean;
}

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
    apiClient<TB>(`/v1/accounting/trial-balance?${params}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, bookType]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Trial Balance</h1>

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
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.rows.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No activity in this period</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.account_code}>
                  <td className="px-4 py-2 text-sm font-mono">{r.account_code}</td>
                  <td className="px-4 py-2 text-sm">{r.account_name}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{r.account_class}</td>
                  <td className="px-4 py-2 text-sm text-right">{r.debit_balance_pkr > 0 ? r.debit_balance_pkr.toLocaleString() : ''}</td>
                  <td className="px-4 py-2 text-sm text-right">{r.credit_balance_pkr > 0 ? r.credit_balance_pkr.toLocaleString() : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-sm text-right">Totals</td>
                <td className="px-4 py-3 text-sm text-right">{data.total_debit_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right">{data.total_credit_pkr.toLocaleString()}</td>
              </tr>
              <tr className={data.is_balanced ? 'text-green-700' : 'text-red-700'}>
                <td colSpan={5} className="px-4 py-2 text-sm text-right">
                  {data.is_balanced ? '✓ Trial balance balanced' : '✗ UNBALANCED — system error, investigate immediately'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
