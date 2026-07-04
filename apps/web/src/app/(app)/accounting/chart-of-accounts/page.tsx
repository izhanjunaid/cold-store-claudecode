'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

import { DataTableSkeleton } from '@/components/data-table';
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

const CLASS_TONE: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  ASSET: 'info',
  LIABILITY: 'warning',
  EQUITY: 'neutral',
  REVENUE: 'success',
  COST_OF_SERVICE: 'warning',
  EXPENSE: 'danger',
};

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function ChartOfAccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (classFilter) params.set('account_class', classFilter);
      setAccounts(await apiClient<Account[]>(`/v1/accounting/accounts?${params}`));
    } finally {
      setLoading(false);
    }
  }, [classFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return (
    <div>
      <PageHeader
        title="Chart of Accounts"
        description="The facility's general-ledger account structure"
        actions={
          <div className="flex items-center gap-2">
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={SELECT_CLASS}>
              <option value="">All Classes</option>
              <option value="ASSET">Assets</option>
              <option value="LIABILITY">Liabilities</option>
              <option value="EQUITY">Equity</option>
              <option value="REVENUE">Revenue</option>
              <option value="COST_OF_SERVICE">Cost of Service</option>
              <option value="EXPENSE">Expenses</option>
            </select>
            <span className="text-sm text-muted-foreground">{accounts.length} accounts</span>
          </div>
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Normal</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={6} rows={5} />
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No accounts</TableCell>
              </TableRow>
            ) : (
              accounts.map((a) => (
                <TableRow key={a.id} className={a.account_type === 'HEADER' ? 'bg-muted/40 font-semibold' : ''}>
                  <TableCell className="font-mono">{a.account_code}</TableCell>
                  <TableCell>
                    {a.account_type === 'DETAIL' && a.parent_account_code ? '↳ ' : ''}
                    {a.account_name}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.account_class} tone={CLASS_TONE[a.account_class] ?? 'neutral'} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.account_type}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{a.normal_balance}</TableCell>
                  <TableCell className="text-xs">
                    {a.is_system_account ? (
                      <span className="text-blue-600">System</span>
                    ) : a.is_active ? (
                      <span className="text-green-600">Active</span>
                    ) : (
                      <span className="text-muted-foreground">Inactive</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
