'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DEFAULT_BANK_ACCOUNT_CODE } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function NewFixedAssetPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = can(user, 'fixed_assets.manage');

  const [name, setName] = useState('');
  const [category, setCategory] = useState('COLD_PLANT');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [cost, setCost] = useState('');
  const [residual, setResidual] = useState('0');
  const [method, setMethod] = useState<'SLM' | 'WDV'>('WDV');
  const [usefulLife, setUsefulLife] = useState('');
  const [wdvRate, setWdvRate] = useState('20');
  // Default stays 1020 (bank) so an untouched form posts as it did before.
  const [paidFrom, setPaidFrom] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An asset is funded either out of cash/bank or by taking on a long-term
  // liability (2100's children — equipment finance, director's loan). Both were
  // hardcoded here before; keep both, read from the live chart.
  const { data: accounts = [] } = useAccounts();
  const fundingAccounts = accounts.filter(
    (a) => isCashOrBank(a) || a.parent_account_code === '2100',
  );

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="New Fixed Asset" />
        <p className="text-muted-foreground">Only the OWNER can register fixed assets.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        asset_name: name,
        asset_category: category,
        purchase_date: purchaseDate,
        purchase_cost_pkr: Number(cost),
        residual_value_pkr: Number(residual) || 0,
        depreciation_method: method,
        paid_from_account_code: paidFrom,
        notes: notes || undefined,
      };
      if (method === 'SLM') payload['useful_life_years'] = Number(usefulLife);
      else payload['wdv_rate_percent'] = Number(wdvRate);
      const created = await apiClient<{ id: string }>('/v1/fixed-assets', { method: 'POST', body: payload });
      toast.success('Asset created · JE-12 posted');
      router.push(`/accounting/fixed-assets/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create asset');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New Fixed Asset" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Asset Name <span className="text-destructive">*</span></Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bitzer Compressor Unit 1" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category <span className="text-destructive">*</span></Label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT_CLASS}>
                  <option value="COLD_PLANT">Cold Plant (5040 direct cost)</option>
                  <option value="BUILDING">Building (6120 indirect)</option>
                  <option value="VEHICLE">Vehicle (6130)</option>
                  <option value="COMPUTER">Computer (6140)</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Date <span className="text-destructive">*</span></Label>
                <Input type="date" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Purchase Cost (PKR) <span className="text-destructive">*</span></Label>
                <Input type="number" required min={0} step={0.01} value={cost} onChange={(e) => setCost(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Residual Value (PKR)</Label>
                <Input type="number" min={0} step={0.01} value={residual} onChange={(e) => setResidual(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Depreciation Method <span className="text-destructive">*</span></Label>
                <select value={method} onChange={(e) => setMethod(e.target.value as 'SLM' | 'WDV')} className={SELECT_CLASS}>
                  <option value="WDV">WDV (Written-Down Value)</option>
                  <option value="SLM">SLM (Straight Line)</option>
                </select>
              </div>
              {method === 'SLM' ? (
                <div className="space-y-1.5">
                  <Label>Useful Life (Years) <span className="text-destructive">*</span></Label>
                  <Input type="number" required min={0.5} step={0.5} value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} placeholder="e.g. 30" className="tabular-nums" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>WDV Rate (%) <span className="text-destructive">*</span></Label>
                  <Input type="number" required min={0.1} max={100} step={0.1} value={wdvRate} onChange={(e) => setWdvRate(e.target.value)} placeholder="e.g. 20" className="tabular-nums" />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Paid From Account</Label>
              <select value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className={SELECT_CLASS}>
                {fundingAccounts.map((a) => (
                  <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create & Post JE-12'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
