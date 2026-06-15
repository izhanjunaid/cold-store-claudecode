'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

interface Commodity {
  id: string;
  name: string;
}

const EMPTY = {
  name: '',
  commodity_id: '',
  rate_type: 'SEASONAL_PER_BAG',
  rate_amount_pkr: '',
  season_start_date: '',
  season_end_date: '',
  min_billing_days: '1',
};
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function RatePlanCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient<Commodity[]>('/v1/commodities').then(setCommodities).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isSeasonal = form.rate_type === 'SEASONAL_PER_BAG';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        rate_type: form.rate_type,
        rate_amount_pkr: parseFloat(form.rate_amount_pkr),
        min_billing_days: parseInt(form.min_billing_days) || 1,
      };
      if (form.commodity_id) payload['commodity_id'] = form.commodity_id;
      if (isSeasonal) {
        payload['season_start_date'] = form.season_start_date;
        payload['season_end_date'] = form.season_end_date;
      }
      await apiClient('/v1/rate-plans', { method: 'POST', body: payload });
      toast.success('Rate plan created');
      router.push('/billing/rate-plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rate plan');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Create Rate Plan" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. Potato Seasonal 2026" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Commodity</Label>
                <select value={form.commodity_id} onChange={(e) => set('commodity_id', e.target.value)} className={SELECT_CLASS}>
                  <option value="">All Commodities</option>
                  {commodities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Rate Type <span className="text-destructive">*</span></Label>
                <select value={form.rate_type} onChange={(e) => set('rate_type', e.target.value)} className={SELECT_CLASS}>
                  <option value="SEASONAL_PER_BAG">Seasonal / Bag</option>
                  <option value="MONTHLY_PER_BAG">Monthly / Bag</option>
                  <option value="DAILY_PER_BAG">Daily / Bag</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Rate Amount (PKR) <span className="text-destructive">*</span></Label>
                <Input type="number" step={0.01} min={0.01} value={form.rate_amount_pkr} onChange={(e) => set('rate_amount_pkr', e.target.value)} required className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Min Billing Days</Label>
                <Input type="number" min={1} value={form.min_billing_days} onChange={(e) => set('min_billing_days', e.target.value)} className="tabular-nums" />
              </div>
              {isSeasonal && (
                <>
                  <div className="space-y-1.5">
                    <Label>Season Start <span className="text-destructive">*</span></Label>
                    <Input type="date" value={form.season_start_date} onChange={(e) => set('season_start_date', e.target.value)} required className="tabular-nums" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Season End <span className="text-destructive">*</span></Label>
                    <Input type="date" value={form.season_end_date} onChange={(e) => set('season_end_date', e.target.value)} required className="tabular-nums" />
                  </div>
                </>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Rate Plan'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
