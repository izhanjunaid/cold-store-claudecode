'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DEFAULT_BANK_ACCOUNT_CODE, PERMISSION_REGISTRY, localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import type { AccountRef } from '@/hooks/use-reference-data';
import { CATEGORY_LABELS } from '../category-labels';
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
  const [purchaseDate, setPurchaseDate] = useState(localIsoDate());
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

  // An asset is paid for out of cash or a bank account, or financed by a long-term
  // liability (equipment finance, a director's loan). Both are read off the chart's
  // own properties — the cash-equivalent flag and the header's statement section —
  // so an account the owner adds appears here too.
  const { data: chart = [] } = useQuery({
    queryKey: ['accounts', 'with-headers'],
    queryFn: () => apiClient<Array<AccountRef & { statement_section: string | null }>>('/v1/accounting/accounts?is_active=true'),
  });
  const longTermHeaders = new Set(
    chart.filter((a) => a.account_type === 'HEADER' && a.statement_section === 'NON_CURRENT_LIABILITY').map((a) => a.account_code),
  );
  const fundingAccounts = chart.filter(
    (a) =>
      a.account_type === 'DETAIL' &&
      (a.is_cash_equivalent || (a.parent_account_code !== null && longTermHeaders.has(a.parent_account_code))),
  );

  if (!canCreate) {
    const need = PERMISSION_REGISTRY.find((p) => p.key === 'fixed_assets.manage')!.label;
    return (
      <div>
        <PageHeader title="New Fixed Asset" />
        <p className="text-muted-foreground">You need the “{need}” permission to register fixed assets.</p>
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
      toast.success('Asset registered');
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
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Asset Name <span className="text-destructive">*</span></Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bitzer Compressor Unit 1" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Category <span className="text-destructive">*</span></Label>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT_CLASS}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
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
              <Label>Paid From / Financed By</Label>
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
              <Button type="submit" disabled={submitting}>{submitting ? 'Registering…' : 'Register Asset'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
