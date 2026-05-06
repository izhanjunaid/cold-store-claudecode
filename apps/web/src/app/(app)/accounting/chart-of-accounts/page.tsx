'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_class: string;
  account_type: 'HEADER' | 'DETAIL';
  parent_account_code: string | null;
  normal_balance: 'DEBIT' | 'CREDIT';
  is_system_account: boolean;
  is_active: boolean;
}

const CLASS_COLORS: Record<string, string> = {
  ASSET: 'bg-blue-100 text-blue-800',
  LIABILITY: 'bg-orange-100 text-orange-800',
  EQUITY: 'bg-purple-100 text-purple-800',
  REVENUE: 'bg-green-100 text-green-800',
  COST_OF_SERVICE: 'bg-yellow-100 text-yellow-800',
  EXPENSE: 'bg-red-100 text-red-800',
};

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (classFilter) params.set('account_class', classFilter);
      const data = await apiClient<Account[]>(`/v1/accounting/accounts?${params}`);
      setAccounts(data);
    } finally {
      setLoading(false);
    }
  }, [classFilter]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Chart of Accounts</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex gap-4">
        <select
          value={classFilter}
          onChange={(e) => setClassFilter((e.target as HTMLSelectElement).value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Classes</option>
          <option value="ASSET">Assets</option>
          <option value="LIABILITY">Liabilities</option>
          <option value="EQUITY">Equity</option>
          <option value="REVENUE">Revenue</option>
          <option value="COST_OF_SERVICE">Cost of Service</option>
          <option value="EXPENSE">Expenses</option>
        </select>
        <span className="text-sm text-gray-500 self-center">
          {accounts.length} account{accounts.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Code</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Normal</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-500">No accounts</td></tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className={a.account_type === 'HEADER' ? 'bg-gray-50 font-semibold' : ''}>
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">{a.account_code}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {a.account_type === 'DETAIL' && a.parent_account_code ? '↳ ' : ''}
                    {a.account_name}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${CLASS_COLORS[a.account_class]}`}>
                      {a.account_class}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{a.account_type}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{a.normal_balance}</td>
                  <td className="px-4 py-3 text-xs">
                    {a.is_system_account ? (
                      <span className="text-blue-600">System</span>
                    ) : a.is_active ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-gray-400">Inactive</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
