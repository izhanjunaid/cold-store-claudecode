'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
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
import { suggestNextCode } from './next-code';

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

// One label set for both the filter and the dialog — they used to disagree
// ("Cost of Service" vs "COST OF SERVICE") because each hand-wrote its own.
const CLASS_LABEL: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  COST_OF_SERVICE: 'Cost of Service',
  EXPENSE: 'Expenses',
};

// Debit-normal classes; the rest default to credit. Overridable in the form
// for contra accounts (e.g. accumulated depreciation is ASSET / CREDIT).
const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE', 'COST_OF_SERVICE']);

// Mirrors CLASS_CODE_PREFIX in coa.service.ts. Leading digits 0/7/8/9 stay
// legal — owners open custom heads there and the statements surface them in the
// unclassified bucket (F-6b).
const CLASS_LEAD_DIGIT: Record<string, string> = {
  ASSET: '1', LIABILITY: '2', EQUITY: '3', REVENUE: '4', COST_OF_SERVICE: '5', EXPENSE: '6',
};
const ASSIGNED_LEAD_DIGITS = new Set(Object.values(CLASS_LEAD_DIGIT));

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Opens on the class the table is filtered to — adding an expense account from
// the Expenses view should not start you on Assets.
const emptyDraft = (cls = 'ASSET') => ({
  code: '',
  name: '',
  cls,
  parent: '',
  normal: (DEBIT_NORMAL.has(cls) ? 'DEBIT' : 'CREDIT') as 'DEBIT' | 'CREDIT',
});

export default function ChartOfAccountsPage() {
  const confirm = useConfirm();
  // Gate on the permission key, not a hard-coded OWNER check, so an owner who
  // delegates accounting.manage_accounts sees the controls (phase/19 audit).
  const canManage = useCan('accounting.manage_accounts');

  const [accounts, setAccounts] = useState<Account[]>([]);
  // Unfiltered copy, so the Add dialog's parent list never depends on the table filter.
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
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
      const [filtered, all] = await Promise.all([
        apiClient<Account[]>(`/v1/accounting/accounts?${params}`),
        // The Add-account dialog needs every header, not just the filtered
        // class: sharing the filtered list left the parent dropdown empty
        // whenever the draft's class differed from the table filter, which
        // disabled the submit button with nothing on screen explaining why.
        classFilter ? apiClient<Account[]>('/v1/accounting/accounts') : Promise.resolve(null),
      ]);
      setAccounts(filtered);
      setAllAccounts(all ?? filtered);
    } finally {
      setLoading(false);
    }
  }, [classFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Client-side: the list is small and already loaded, so a round trip per
  // keystroke would buy nothing.
  const visibleAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.account_code.includes(q) || a.account_name.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const headerOptions = useMemo(
    () => allAccounts.filter((a) => a.account_type === 'HEADER' && a.account_class === draft.cls),
    [allAccounts, draft.cls],
  );
  // Equity accounts sit at the root (built by class on the balance sheet);
  // every other class needs a header for the statements to place it.
  const parentRequired = draft.cls !== 'EQUITY';

  // Prefill only — never auto-assign. A code is permanent once the account has
  // postings (guard_chart_of_accounts + the JE-line FK's ON UPDATE RESTRICT),
  // so a silently-wrong code cannot be corrected later.
  const selectParent = (parent: string) =>
    setDraft((d) => ({ ...d, parent, code: parent ? suggestNextCode(allAccounts, parent) : '' }));

  // Mirrors the server's rules (shared CreateAccountRequest + coa.service) so
  // the failure arrives next to the field rather than as a toast after a POST.
  const codeError = (() => {
    if (!draft.code) return null;
    if (draft.code.length < 2) return 'At least 2 digits.';
    if (allAccounts.some((a) => a.account_code === draft.code)) {
      return `${draft.code} is already in use.`;
    }
    const expected = CLASS_LEAD_DIGIT[draft.cls];
    const lead = draft.code.charAt(0);
    if (expected && lead !== expected && ASSIGNED_LEAD_DIGITS.has(lead)) {
      return `Codes starting with ${lead} belong to another class; ${CLASS_LABEL[draft.cls]} use ${expected}.`;
    }
    return null;
  })();

  const validationError =
    codeError ??
    (!draft.code ? 'Enter an account code.' : null) ??
    (!draft.name.trim() ? 'Enter an account name.' : null) ??
    (parentRequired && !draft.parent ? 'Select a parent header.' : null);

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
      setDraft(emptyDraft(classFilter || 'ASSET'));
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
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code or name…"
              className="h-9 w-52"
              aria-label="Search accounts"
            />
            <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className={SELECT_CLASS}>
              <option value="">All Classes</option>
              {ACCOUNT_CLASSES.map((c) => (
                <option key={c} value={c}>{CLASS_LABEL[c]}</option>
              ))}
            </select>
            <span className="text-sm text-muted-foreground">{visibleAccounts.length} accounts</span>
            {canManage && (
              <Button size="sm" onClick={() => { setDraft(emptyDraft(classFilter || 'ASSET')); setShowAdd(true); }}>
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
              {canManage && <TableHead className="w-44 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={canManage ? 7 : 6} rows={5} />
            ) : visibleAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6} className="h-24 text-center text-muted-foreground">No accounts</TableCell>
              </TableRow>
            ) : (
              visibleAccounts.map((a) => (
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
                  {canManage && (
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
              Accounts under a standard header appear in that statement section; anything else
              shows under &ldquo;Unclassified&rdquo;. Code, class, and parent are permanent once the
              account has postings.
            </DialogDescription>
          </DialogHeader>
          {/* Ordered by dependency: class decides the valid parents, the parent
              decides the code block. Asking for the code first (as this form
              used to) asks for the derived value before its inputs. */}
          <div className="space-y-3">
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
                    code: '',
                    normal: DEBIT_NORMAL.has(e.target.value) ? 'DEBIT' : 'CREDIT',
                  }))
                }
                className={SELECT_CLASS}
              >
                {ACCOUNT_CLASSES.map((c) => (
                  <option key={c} value={c}>{CLASS_LABEL[c]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-parent">
                Parent (header){parentRequired && <span className="text-destructive"> *</span>}
              </Label>
              <select
                id="coa-parent"
                value={draft.parent}
                onChange={(e) => selectParent(e.target.value)}
                className={SELECT_CLASS}
              >
                {parentRequired ? (
                  <option value="" disabled>Select header…</option>
                ) : (
                  <option value="">— none —</option>
                )}
                {headerOptions.map((h) => (
                  <option key={h.account_code} value={h.account_code}>
                    {h.account_code} — {h.account_name}
                  </option>
                ))}
              </select>
              {parentRequired && headerOptions.length === 0 && (
                <p className="text-xs text-destructive">
                  No header accounts exist for {CLASS_LABEL[draft.cls] ?? draft.cls}.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-name">Account name <span className="text-destructive">*</span></Label>
              <Input
                id="coa-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Generator Fuel"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coa-code">Account code <span className="text-destructive">*</span></Label>
              <Input
                id="coa-code"
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.replace(/[^0-9]/g, '').slice(0, 10) }))}
                placeholder="e.g. 6095"
                className="font-mono"
                inputMode="numeric"
              />
              {codeError ? (
                <p className="text-xs text-destructive">{codeError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Suggested from the parent&rsquo;s range. Editable now — permanent once the
                  account has postings.
                </p>
              )}
            </div>
            <details className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm text-muted-foreground">Advanced</summary>
              <div className="mt-2 space-y-1.5">
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
                <p className="text-xs text-muted-foreground">
                  Set from the class. Change it only for a contra account — accumulated
                  depreciation is an asset with a credit balance.
                </p>
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={createAccount} disabled={saving || !!validationError}>
              {saving ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
          {/* The code error already has its own slot under that field — only
              surface the remaining "what's still missing" prompt here. */}
          {validationError && validationError !== codeError && !saving && (
            <p className="text-right text-xs text-muted-foreground">{validationError}</p>
          )}
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
