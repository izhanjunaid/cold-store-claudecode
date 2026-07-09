'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { useConfirm } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

const ACCOUNT_CLASSES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST_OF_SERVICE', 'EXPENSE'] as const;

// Debit-normal classes; the rest default to credit. Overridable in the form
// for contra accounts (e.g. accumulated depreciation is ASSET / CREDIT).
const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE', 'COST_OF_SERVICE']);

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const emptyDraft = () => ({
  code: '',
  name: '',
  cls: 'ASSET' as string,
  parent: '',
  normal: 'DEBIT' as 'DEBIT' | 'CREDIT',
});

export default function ChartOfAccountsPage() {
  const { user } = useAuthStore();
  const confirm = useConfirm();
  const isOwner = user?.role === 'OWNER';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [newName, setNewName] = useState('');

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

  const headerOptions = useMemo(
    () => accounts.filter((a) => a.account_type === 'HEADER' && a.account_class === draft.cls),
    [accounts, draft.cls],
  );

  const createAccount = async () => {
    setSaving(true);
    try {
      await apiClient('/v1/accounting/accounts', {
        method: 'POST',
        body: {
          account_code: draft.code.trim(),
          account_name: draft.name.trim(),
          account_class: draft.cls,
          account_type: 'DETAIL',
          parent_account_code: draft.parent || null,
          normal_balance: draft.normal,
        },
      });
      toast.success(`Account ${draft.code} — ${draft.name} created`);
      setShowAdd(false);
      setDraft(emptyDraft());
      await fetchAccounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create account');
    } finally {
      setSaving(false);
    }
  };

  const saveRename = async () => {
    if (!renaming) return;
    setSaving(true);
    try {
      await apiClient(`/v1/accounting/accounts/${renaming.account_code}`, {
        method: 'PATCH',
        body: { account_name: newName.trim() },
      });
      toast.success(`Account ${renaming.account_code} renamed`);
      setRenaming(null);
      await fetchAccounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to rename account');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (a: Account) => {
    if (a.is_active) {
      const ok = await confirm({
        title: `Deactivate ${a.account_code} — ${a.account_name}?`,
        description:
          'An inactive account cannot be posted to — invoices, payments, and journal entries that use it will be rejected. Its history stays on every report, and you can reactivate it any time.',
        confirmText: 'Deactivate',
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await apiClient(`/v1/accounting/accounts/${a.account_code}`, {
        method: 'PATCH',
        body: { is_active: !a.is_active },
      });
      toast.success(`Account ${a.account_code} ${a.is_active ? 'deactivated' : 'reactivated'}`);
      await fetchAccounts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update account');
    }
  };

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
            {isOwner && (
              <Button size="sm" onClick={() => { setDraft(emptyDraft()); setShowAdd(true); }}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add account
              </Button>
            )}
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
              {isOwner && <TableHead className="w-44 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={isOwner ? 7 : 6} rows={5} />
            ) : accounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOwner ? 7 : 6} className="h-24 text-center text-muted-foreground">No accounts</TableCell>
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
                  {isOwner && (
                    <TableCell className="text-right">
                      {!a.is_system_account && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setRenaming(a); setNewName(a.account_name); }}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={a.is_active ? 'text-destructive' : undefined}
                            onClick={() => toggleActive(a)}
                          >
                            {a.is_active ? 'Deactivate' : 'Activate'}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showAdd} onOpenChange={(o) => !o && setShowAdd(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>
              New accounts are DETAIL accounts — they must sit under a header of the same class to
              appear on the statements. Code, class, and parent are permanent once the account has
              postings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coa-code">Account code</Label>
                <Input
                  id="coa-code"
                  value={draft.code}
                  onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.replace(/[^0-9]/g, '') }))}
                  placeholder="e.g. 6095"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coa-class">Class</Label>
                <select
                  id="coa-class"
                  value={draft.cls}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      cls: e.target.value,
                      parent: '',
                      normal: DEBIT_NORMAL.has(e.target.value) ? 'DEBIT' : 'CREDIT',
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  {ACCOUNT_CLASSES.map((c) => (
                    <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-name">Account name</Label>
              <Input
                id="coa-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Generator Fuel"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="coa-parent">Parent (header)</Label>
                <select
                  id="coa-parent"
                  value={draft.parent}
                  onChange={(e) => setDraft((d) => ({ ...d, parent: e.target.value }))}
                  className={SELECT_CLASS}
                >
                  <option value="">— none —</option>
                  {headerOptions.map((h) => (
                    <option key={h.account_code} value={h.account_code}>
                      {h.account_code} — {h.account_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="coa-normal">Normal balance</Label>
                <select
                  id="coa-normal"
                  value={draft.normal}
                  onChange={(e) => setDraft((d) => ({ ...d, normal: e.target.value as 'DEBIT' | 'CREDIT' }))}
                  className={SELECT_CLASS}
                >
                  <option value="DEBIT">DEBIT</option>
                  <option value="CREDIT">CREDIT</option>
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={createAccount} disabled={saving || draft.code.length < 2 || !draft.name.trim()}>
              {saving ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename {renaming?.account_code}</DialogTitle>
            <DialogDescription>
              The new name appears on all future and regenerated reports. The account code and its
              posting history do not change.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="coa-rename">New name</Label>
            <Input id="coa-rename" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
            <Button onClick={saveRename} disabled={saving || !newName.trim()}>
              {saving ? 'Saving…' : 'Save name'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
