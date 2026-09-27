'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PERMISSION_REGISTRY, type OpeningAssetTieOutResponseType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';
import { CATEGORY_LABELS } from '../category-labels';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const TIE_OUT_KEY = ['fixed-assets', 'opening-tie-out'];

const EMPTY = {
  name: '',
  category: 'COLD_PLANT',
  purchaseDate: '',
  cost: '',
  accumulated: '0',
  residual: '0',
  method: 'SLM' as 'SLM' | 'WDV',
  life: '',
  rate: '20',
  inServiceFrom: '',
};

/**
 * Assets the business already owned at go-live (docs/25 C-30). Their cost and the
 * depreciation charged on them so far are in the opening-balance entry, so adding
 * them here posts nothing — it only puts them on the register, where depreciation
 * carries on from the month after go-live. The table ties the register to the
 * opening entry account by account.
 */
export default function OpeningAssetsPage() {
  const { user } = useAuthStore();
  const canView = can(user, 'accounting.view');
  const canAdd = can(user, 'fixed_assets.manage');
  const queryClient = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  const { data: tie } = useQuery({
    queryKey: TIE_OUT_KEY,
    queryFn: () => apiClient<OpeningAssetTieOutResponseType>('/v1/fixed-assets/opening-tie-out'),
    enabled: canView,
  });

  if (!canView) {
    const need = PERMISSION_REGISTRY.find((p) => p.key === 'accounting.view')!.label;
    return (
      <div>
        <PageHeader title="Assets Owned at Go-Live" />
        <p className="text-muted-foreground">You need the “{need}” permission to see the fixed-asset register.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient('/v1/fixed-assets/opening', {
        method: 'POST',
        body: {
          assets: [
            {
              asset_name: form.name,
              asset_category: form.category,
              purchase_date: form.purchaseDate,
              purchase_cost_pkr: Number(form.cost),
              accumulated_depreciation_pkr: Number(form.accumulated) || 0,
              residual_value_pkr: Number(form.residual) || 0,
              depreciation_method: form.method,
              ...(form.method === 'SLM' ? { useful_life_years: Number(form.life) } : { wdv_rate_percent: Number(form.rate) }),
              ...(form.inServiceFrom ? { depreciation_start_date: form.inServiceFrom } : {}),
            },
          ],
        },
      });
      toast.success(`${form.name} added to the register`);
      setForm(EMPTY);
      await queryClient.invalidateQueries({ queryKey: TIE_OUT_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add the asset');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Assets Owned at Go-Live"
        crumb="Go-live register"
        description="Put the assets already in the opening balances onto the fixed-asset register — without posting them again."
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <h2 className="mb-2 text-sm font-semibold">Register against opening balances</h2>
          {!tie?.opening_date ? (
            <p className="text-sm text-muted-foreground">
              No opening balances have been entered yet. Enter them first under{' '}
              <Link className="underline" href="/accounting/opening-balances">Opening Balances</Link>; the assets listed
              here must add up to what that entry carries.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                Opening balances as of {formatDate(tie.opening_date)}.{' '}
                {tie.is_reconciled
                  ? 'Every fixed-asset account on the register agrees with them.'
                  : 'A difference means assets are still to be added, or the opening balances need correcting.'}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="h-8 hover:bg-transparent">
                      <TableHead className="h-8">Account</TableHead>
                      <TableHead className="h-8">Carries</TableHead>
                      <TableHead className="h-8 text-right">Opening balances</TableHead>
                      <TableHead className="h-8 text-right">Register</TableHead>
                      <TableHead className="h-8 text-right">Still to add</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tie.accounts.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="h-16 text-center text-muted-foreground">The opening balances carry no fixed assets</TableCell></TableRow>
                    ) : (
                      tie.accounts.map((r) => (
                        <TableRow key={r.account_code} className="h-7">
                          <TableCell className="py-1">{r.account_name}</TableCell>
                          <TableCell className="py-1 text-muted-foreground">{r.kind === 'COST' ? 'Cost' : 'Depreciation to go-live'}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{formatMoney(r.ledger_pkr)}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{formatMoney(r.register_pkr)}</TableCell>
                          <TableCell className={`py-1 text-right tabular-nums ${Math.abs(r.difference_pkr) >= 0.005 ? 'font-medium text-amber-700' : 'text-muted-foreground'}`}>
                            {formatMoney(r.difference_pkr)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {canAdd && tie?.opening_date && (
        <Card>
          <CardContent className="p-4">
            <h2 className="mb-3 text-sm font-semibold">Add an asset owned at go-live</h2>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Asset Name <span className="text-destructive">*</span></Label>
                  <Input required value={form.name} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Category <span className="text-destructive">*</span></Label>
                  <select value={form.category} onChange={(e) => set({ category: e.target.value })} className={SELECT_CLASS}>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Bought On <span className="text-destructive">*</span></Label>
                  <Input type="date" required max={tie.opening_date} value={form.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Cost (PKR) <span className="text-destructive">*</span></Label>
                  <Input type="number" required min={0} step={0.01} value={form.cost} onChange={(e) => set({ cost: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Depreciation to go-live (PKR)</Label>
                  <Input type="number" min={0} step={0.01} value={form.accumulated} onChange={(e) => set({ accumulated: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>In Service Since</Label>
                  <Input type="date" max={tie.opening_date} value={form.inServiceFrom} onChange={(e) => set({ inServiceFrom: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Residual Value (PKR)</Label>
                  <Input type="number" min={0} step={0.01} value={form.residual} onChange={(e) => set({ residual: e.target.value })} className="tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label>Depreciation Method <span className="text-destructive">*</span></Label>
                  <select value={form.method} onChange={(e) => set({ method: e.target.value as 'SLM' | 'WDV' })} className={SELECT_CLASS}>
                    <option value="SLM">SLM (Straight Line)</option>
                    <option value="WDV">WDV (Written-Down Value)</option>
                  </select>
                </div>
                {form.method === 'SLM' ? (
                  <div className="space-y-1.5">
                    <Label>Useful Life (Years) <span className="text-destructive">*</span></Label>
                    <Input type="number" required min={0.5} step={0.5} value={form.life} onChange={(e) => set({ life: e.target.value })} className="tabular-nums" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>WDV Rate (%) <span className="text-destructive">*</span></Label>
                    <Input type="number" required min={0.1} max={100} step={0.1} value={form.rate} onChange={(e) => set({ rate: e.target.value })} className="tabular-nums" />
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Nothing is posted: the opening balances already hold this asset. Leave &ldquo;In service since&rdquo; empty
                for an asset not yet in use; it can be commissioned later.
              </p>
              {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
              <Button type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add to register'}</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
