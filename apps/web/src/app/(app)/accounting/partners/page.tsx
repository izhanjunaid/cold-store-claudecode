'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { formatDate } from '@/lib/format';

interface Partner {
  id: string;
  name: string;
  capital_account_code: string;
  capital_account_name: string;
  drawings_account_code: string;
  drawings_account_name: string;
  admitted_on: string;
  retired_on: string | null;
}

interface ShareWindow {
  effective_from: string;
  shares: { partner_id: string; partner_name: string; weight: number; share_pct: number }[];
}

const today = () => new Date().toISOString().slice(0, 10);

export default function PartnersPage() {
  const { user } = useAuthStore();
  const canManage = can(user, 'accounting.manage_partners');

  const [partners, setPartners] = useState<Partner[]>([]);
  const [windows, setWindows] = useState<ShareWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [admittedOn, setAdmittedOn] = useState(today);

  // Weights per partner for a new ratio window, keyed by partner id.
  const [ratioFrom, setRatioFrom] = useState(today);
  const [weights, setWeights] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ps, ws] = await Promise.all([
        apiClient<Partner[]>('/v1/partners'),
        apiClient<ShareWindow[]>('/v1/partners/profit-shares'),
      ]);
      setPartners(ps);
      setWindows(ws);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => partners.filter((p) => !p.retired_on), [partners]);

  const addPartner = async () => {
    setSaving(true);
    try {
      await apiClient('/v1/partners', {
        method: 'POST',
        body: { name: name.trim(), admitted_on: admittedOn },
      });
      toast.success(`${name.trim()} added, with their capital and drawings accounts`);
      setAdding(false);
      setName('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add the owner');
    } finally {
      setSaving(false);
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
    setSaving(true);
    try {
      await apiClient('/v1/partners/profit-shares', {
        method: 'PUT',
        body: { effective_from: ratioFrom, shares },
      });
      toast.success('Profit-sharing ratio saved');
      setWeights({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the ratio');
    } finally {
      setSaving(false);
    }
  };

  // Partnership Act 1932 s.13(b) gives equal shares unless the partners agree
  // otherwise. Offered, never applied on its own — the owners have to choose it.
  const applyEqualShares = () =>
    setWeights(Object.fromEntries(active.map((p) => [p.id, '1'])));

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

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Capital account</TableHead>
                <TableHead>Drawings account</TableHead>
                <TableHead>Admitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                    No owners recorded yet. Adding one opens their capital and drawings accounts
                    together — an owner with only one of the two is the state this screen exists to
                    make impossible.
                  </TableCell>
                </TableRow>
              )}
              {partners.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    {p.retired_on && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        retired {formatDate(p.retired_on)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{p.capital_account_code}</TableCell>
                  <TableCell className="font-mono text-xs">{p.drawings_account_code}</TableCell>
                  <TableCell className="text-sm">{formatDate(p.admitted_on)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <h2 className="mt-6 text-sm font-medium">Profit-sharing ratio</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Shares are weights, not percentages — 3 and 1 mean the same as 75 and 25, and a set of
        weights can never fail to add up. Each ratio applies <strong>from its date onward</strong>,
        so the year an owner joins splits automatically at the old ratio before and the new one
        after. Nothing is posted: the statement of changes in equity discloses each owner&apos;s
        share rather than moving it into their account.
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
                <Input
                  id="ratio-from"
                  type="date"
                  value={ratioFrom}
                  onChange={(e) => setRatioFrom(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button variant="outline" onClick={applyEqualShares}>
                Equal shares
              </Button>
              <p className="text-xs text-muted-foreground">
                Partnership Act 1932 s.13(b) gives partners equal shares unless they agree
                otherwise. Offered here, not applied on its own.
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
              <Input
                id="p-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Junaid"
              />
              <p className="text-xs text-muted-foreground">
                Two accounts are opened for them — <span className="font-mono">3100</span> capital
                and <span className="font-mono">3200</span> drawings — with codes taken from those
                blocks. You never have to choose a code.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="p-admitted">Admitted on</Label>
              <Input
                id="p-admitted"
                type="date"
                value={admittedOn}
                onChange={(e) => setAdmittedOn(e.target.value)}
              />
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
    </div>
  );
}
