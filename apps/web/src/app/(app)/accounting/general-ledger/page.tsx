'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

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
  account_class: string;
  normal_balance: 'DEBIT' | 'CREDIT';
  date_from: string | null;
  date_to: string | null;
  opening_balance_pkr: number;
  total_debit_pkr: number;
  total_credit_pkr: number;
  closing_balance_pkr: number;
  entries: GLEntry[];
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
      if (detail.length > 0 && !accountCode) {
        setAccountCode(detail[0]!.account_code);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!accountCode) return;
    setLoading(true);
    const params = new URLSearchParams({ account_code: accountCode });
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (bookType) params.set('book_type', bookType);
    apiClient<GLResponse>(`/v1/accounting/general-ledger?${params}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [accountCode, dateFrom, dateTo, bookType]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">General Ledger</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          value={accountCode}
          onChange={(e) => setAccountCode((e.target as HTMLSelectElement).value)}
          className="border rounded-lg px-3 py-2 text-sm font-mono"
        >
          <option value="">Select account...</option>
          {accounts.map((a) => (
            <option key={a.account_code} value={a.account_code}>
              {a.account_code} — {a.account_name}
            </option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)} className="border rounded-lg px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo((e.target as HTMLInputElement).value)} className="border rounded-lg px-3 py-2 text-sm" />
        <select value={bookType} onChange={(e) => setBookType((e.target as HTMLSelectElement).value)} className="border rounded-lg px-3 py-2 text-sm">
          <option value="">PACCI + KATCHI</option>
          <option value="PACCI">PACCI</option>
          <option value="KATCHI">KATCHI</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : !data ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Select an account</div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <div className="text-gray-500">Account</div>
              <div className="font-semibold">{data.account_code} — {data.account_name}</div>
            </div>
            <div>
              <div className="text-gray-500">Opening</div>
              <div className="font-mono">{data.opening_balance_pkr.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-500">Total Debit</div>
              <div className="font-mono">{data.total_debit_pkr.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-500">Total Credit</div>
              <div className="font-mono">{data.total_credit_pkr.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-500">Closing</div>
              <div className="font-mono font-semibold">{data.closing_balance_pkr.toLocaleString()}</div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Party</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lot</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.entries.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-500">No activity</td></tr>
                ) : (
                  data.entries.map((e) => (
                    <tr key={`${e.entry_id}-${e.date}-${e.entry_number}`} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-600">{e.date}</td>
                      <td className="px-3 py-2 text-xs font-mono">{e.entry_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 max-w-md truncate">{e.description}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">{e.party_name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs font-mono">{e.lot_number ?? '—'}</td>
                      <td className="px-3 py-2 text-sm text-right">{e.debit_pkr > 0 ? e.debit_pkr.toLocaleString() : ''}</td>
                      <td className="px-3 py-2 text-sm text-right">{e.credit_pkr > 0 ? e.credit_pkr.toLocaleString() : ''}</td>
                      <td className="px-3 py-2 text-sm text-right font-semibold">{e.balance_pkr.toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
