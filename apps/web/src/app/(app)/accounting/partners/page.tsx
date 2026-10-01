'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  SYSTEM_ACCOUNTS,
  localIsoDate,
  type OpeningBalanceStatusResponseType,
  type PartnerResponseType,
} from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { formatDate, formatMoney } from '@/lib/format';

interface ShareWindow {
  effective_from: string;
  shares: { partner_id: string; partner_name: string; weight: number; share_pct: number }[];
}
interface EquityAccount {
  account_code: string;
  account_name: string;
  account_type: string;
  normal_balance: 'DEBIT' | 'CREDIT';
}

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Equity accounts with a role of their own — never an owner's to adopt.
const REGISTRY_EQUITY = new Set<string>([
  SYSTEM_ACCOUNTS.OPENING_BALANCE_EQUITY,
  SYSTEM_ACCOUNTS.RETAINED_EARNINGS,
  SYSTEM_ACCOUNTS.CURRENT_YEAR_RESULT,
]);

export default function PartnersPage() {
  const { user } = useAuthStore();
  const canManage = can(user, 'accounting.manage_partners');
  const canPost = can(user, 'accounting.post_journal');

  const [partners, setPartners] = useState<PartnerResponseType[]>([]);
  const [windows, setWindows] = useState<ShareWindow[]>([]);
  const [equityAccounts, setEquityAccounts] = useState<EquityAccount[]>([]);
  const [unattributed, setUnattributed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [admittedOn, setAdmittedOn] = useState(() => localIsoDate());
  const [cnic, setCnic] = useState('');
  const [adoptCapital, setAdoptCapital] = useState('');
  const [adoptDrawings, setAdoptDrawings] = useState('');

  // Edit (rename, CNIC, retire)
  const [editing, setEditing] = useState<PartnerResponseType | null>(null);
  const [editName, setEditName] = useState('');
  const [editCnic, setEditCnic] = useState('');
  const [editRetired, setEditRetired] = useState('');

  // Attribute opening equity
  const [attributing, setAttributing] = useState<PartnerResponseType | null>(null);
  const [attributeAmount, setAttributeAmount] = useState('');
  const [attributeDate, setAttributeDate] = useState(() => localIsoDate());

  // Weights per partner for a new ratio window, keyed by partner id.
  const [ratioFrom, setRatioFrom] = useState(() => localIsoDate());
  const [weights, setWeights] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, ws, accounts, opening] = await Promise.all([
        apiClient<PartnerResponseType[]>('/v1/partners'),
        apiClient<ShareWindow[]>('/v1/partners/profit-shares'),
        apiClient<EquityAccount[]>('/v1/accounting/accounts?account_class=EQUITY&is_active=true'),
        apiClient<OpeningBalanceStatusResponseType>('/v1/accounting/opening-balances'),
      ]);
      setPartners(ps);
      setWindows(ws);
      setEquityAccounts(accounts);
      setUnattributed(opening.unattributed_plug_pkr);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => partners.filter((p) => !p.retired_on), [partners]);
  // Accounts nobody owns yet, on the right side, that are no registry role.
  const adoptable = (side: 'CREDIT' | 'DEBIT') => {
    const claimed = new Set(partners.flatMap((p) => [p.capital_account_code, p.drawings_account_code]));
    return equityAccounts.filter(
      (a) => a.account_type === 'DETAIL' && a.normal_balance === side && !claimed.has(a.account_code) && !REGISTRY_EQUITY.has(a.account_code),
    );
  };

  const run = async (work: () => Promise<unknown>, done: string, fail: string) => {
    setSaving(true);
    try {
      await work();
      toast.success(done);
      await load();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : fail);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addPartner = async () => {
    const ok = await run(
      () =>
        apiClient('/v1/partners', {
          method: 'POST',
          body: {
            name: name.trim(),
            admitted_on: admittedOn,
            ...(cnic.trim() ? { cnic: cnic.trim() } : {}),
            ...(adoptCapital ? { capital_account_code: adoptCapital } : {}),
            ...(adoptDrawings ? { drawings_account_code: adoptDrawings } : {}),
          },
        }),
      `${name.trim()} added, with their capital and drawings accounts`,
      'Could not add the owner',
    );
    if (ok) {
      setAdding(false);
      setName('');
      setCnic('');
      setAdoptCapital('');
      setAdoptDrawings('');
    }
  };

  const openEdit = (p: PartnerResponseType) => {
    setEditing(p);
    setEditName(p.name);
    setEditCnic(p.cnic ?? '');
    setEditRetired(p.retired_on ?? '');
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await run(
      () =>
        apiClient(`/v1/partners/${editing.id}`, {
          method: 'PATCH',
          body: { name: editName.trim(), cnic: editCnic.trim() || null, retired_on: editRetired || null },
        }),
      'Owner updated',
      'Could not update the owner',
    );
    if (ok) setEditing(null);
  };

  const attribute = async () => {
    if (!attributing) return;
    const ok = await run(
      () =>
        apiClient(`/v1/partners/${attributing.id}/attribute-opening-equity`, {
          method: 'POST',
          body: { amount_pkr: Number(attributeAmount), date: attributeDate },
        }),
      `Opening equity attributed to ${attributing.name}`,
      'Could not attribute it',
    );
    if (ok) {
      setAttributing(null);
      setAttributeAmount('');
    }
  };

  const saveRatio = async () => {
    const shares = active
      .map((p) => ({ partner_id: p.id, weight: parseFloat(weights[p.id] ?? '') || 0 }))
      .filter((s) => s.weight > 0);
    if (shares.length === 0) {
      toast.error('Give at least one owner a share');
      return;
    }
    const ok = await run(
      () => apiClient('/v1/partners/profit-shares', { method: 'PUT', body: { effective_from: ratioFrom, shares } }),
      'Profit-sharing ratio saved',
      'Could not save the ratio',
    );
    if (ok) setWeights({});
  };

  // Partnership Act 1932 s.13(b) gives equal shares unless the partners agree
  // otherwise. Offered, never applied on its own — the owners have to choose it.
  const applyEqualShares = () => setWeights(Object.fromEntries(active.map((p) => [p.id, '1'])));

  if (loading) return <PageSkeleton />;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Owners"
        crumb="Owners"
        description="Who owns the facility, the accounts that are theirs, and how the result is divided"
        actions={
          canManage ? (
            <Button onClick={() => setAdding(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add owner
            </Button>
          ) : undefined
        }
      />

      {unattributed > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <span className="font-semibold tabular-nums">{formatMoney(unattributed)}</span> of opening equity belongs to
          no owner yet. Use <strong>Attribute opening equity</strong> on each owner below, in the split they agree.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>CNIC</TableHead>
                <TableHead>Capital account</TableHead>
                <TableHead>Drawings account</TableHead>
                <TableHead>Admitted</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    No owners recorded yet. Adding one opens their capital and drawings accounts together — an
                    owner with only one of the two is the state this screen exists to make impossible.
                  </TableCell>
                </TableRow>
              )}
              {partners.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.retired_on && (
                      <span className="ml-2 text-xs text-muted-foreground">retired {formatDate(p.retired_on)}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.cnic ?? '—'}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{p.capital_account_code}</span> {p.capital_account_name}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{p.drawings_account_code}</span> {p.drawings_account_name}
                  </TableCell>
                  <TableCell className="text-sm">{formatDate(p.admitted_on)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {canPost && unattributed > 0 && !p.retired_on && (
                      <Button variant="ghost" size="sm" onClick={() => setAttributing(p)}>
                        Attribute opening equity
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <h2 className="mt-6 text-sm font-medium">Profit-sharing ratio</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Shares are weights, not percentages — 3 and 1 mean the same as 75 and 25, and a set of weights can never
        fail to add up. Each ratio applies <strong>from its date onward</strong>, so the year an owner joins splits
        automatically at the old ratio before and the new one after; a retired owner shares up to and including
        their retirement date. Nothing is posted: the statement of changes in equity discloses each owner&apos;s
        share rather than moving it into their account. A ratio cannot start inside a closed period.
      </p>

      {windows.length > 0 && (
        <Card className="mt-3">
          <CardContent className="p-4 text-sm">
            {windows.map((w) => (
              <div key={w.effective_from} className="border-b py-1.5 last:border-0">
                <span className="text-muted-foreground">From {formatDate(w.effective_from)}: </span>
                {w.shares.map((s) => `${s.partner_name} ${s.share_pct}%`).join(' · ')}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {canManage && active.length > 0 && (
        <Card className="mt-3">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="ratio-from">Effective from</Label>
                <Input id="ratio-from" type="date" value={ratioFrom} onChange={(e) => setRatioFrom(e.target.value)} className="w-40" />
              </div>
              <Button variant="outline" onClick={applyEqualShares}>
                Equal shares
              </Button>
              <p className="text-xs text-muted-foreground">
                Partnership Act 1932 s.13(b) gives partners equal shares unless they agree otherwise. Offered here,
                not applied on its own.
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {active.map((p) => (
                <div key={p.id} className="space-y-1">
                  <Label htmlFor={`w-${p.id}`}>{p.name}</Label>
                  <Input
                    id={`w-${p.id}`}
                    type="number"
                    min="0"
                    step="any"
                    value={weights[p.id] ?? ''}
                    onChange={(e) => setWeights((w) => ({ ...w, [p.id]: e.target.value }))}
                    placeholder="weight"
                    className="tabular-nums"
                  />
                </div>
              ))}
            </div>

            <Button onClick={saveRatio} disabled={saving}>
              {saving ? 'Saving…' : 'Save ratio'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add owner</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Junaid" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="p-admitted">Admitted on</Label>
                <Input id="p-admitted" type="date" value={admittedOn} onChange={(e) => setAdmittedOn(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-cnic">CNIC</Label>
                <Input id="p-cnic" value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="35202-1234567-1" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Their capital and drawings accounts are opened for them, with codes taken from the owners&apos; blocks
              — you never have to choose one. The CNIC lets payroll refuse to employ an owner: what an owner takes is
              a drawing, not a salary.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="p-adopt-capital">Existing capital account (optional)</Label>
                <select id="p-adopt-capital" className={SELECT_CLASS} value={adoptCapital} onChange={(e) => setAdoptCapital(e.target.value)}>
                  <option value="">Open a new one</option>
                  {adoptable('CREDIT').map((a) => (
                    <option key={a.account_code} value={a.account_code}>
                      {a.account_code} — {a.account_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="p-adopt-drawings">Existing drawings account (optional)</Label>
                <select id="p-adopt-drawings" className={SELECT_CLASS} value={adoptDrawings} onChange={(e) => setAdoptDrawings(e.target.value)}>
                  <option value="">Open a new one</option>
                  {adoptable('DEBIT').map((a) => (
                    <option key={a.account_code} value={a.account_code}>
                      {a.account_code} — {a.account_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button onClick={addPartner} disabled={saving || !name.trim()}>
              {saving ? 'Adding…' : 'Add owner'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit owner</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="e-name">Name</Label>
              <Input id="e-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-cnic">CNIC</Label>
              <Input id="e-cnic" value={editCnic} onChange={(e) => setEditCnic(e.target.value)} placeholder="35202-1234567-1" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="e-retired">Retired on (their last day as an owner)</Label>
              <Input id="e-retired" type="date" value={editRetired} onChange={(e) => setEditRetired(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Retiring stops their share of the result after this date; it removes nothing — their accounts and
                history stay on every statement. Leave empty while they are an owner.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving || !editName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={attributing !== null} onOpenChange={(open) => !open && setAttributing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Attribute opening equity to {attributing?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Moves an amount out of Opening Balance Equity, which belongs to no one, into this owner&apos;s capital
            account. {formatMoney(unattributed)} is unattributed.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="a-amount">Amount (PKR)</Label>
              <Input id="a-amount" type="number" min="0" value={attributeAmount} onChange={(e) => setAttributeAmount(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="a-date">Date</Label>
              <Input id="a-date" type="date" value={attributeDate} onChange={(e) => setAttributeDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAttributing(null)}>
              Cancel
            </Button>
            <Button onClick={attribute} disabled={saving || !(Number(attributeAmount) > 0)}>
              Attribute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
