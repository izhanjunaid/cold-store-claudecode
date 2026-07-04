'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';

import { PageSkeleton } from '@/components/page-skeleton';
interface RatePlan {
  id: string;
  name: string;
  commodity_id: string | null;
  rate_type: string;
  rate_amount_pkr: number;
  season_start_date: string | null;
  season_end_date: string | null;
  min_billing_days: number;
  is_active: boolean;
}
interface Commodity {
  id: string;
  name: string;
}
interface FormData {
  name: string;
  commodity_id: string;
  rate_amount_pkr: string;
  season_start_date: string;
  season_end_date: string;
  min_billing_days: string;
  is_active: boolean;
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function RatePlanEditPage() {
  const params = useParams();
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const [rateType, setRateType] = useState('');
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient<RatePlan>(`/v1/rate-plans/${params['id']}`),
      apiClient<Commodity[]>('/v1/commodities'),
    ])
      .then(([plan, comms]) => {
        setCommodities(comms);
        setRateType(plan.rate_type);
        setForm({
          name: plan.name,
          commodity_id: plan.commodity_id || '',
          rate_amount_pkr: String(plan.rate_amount_pkr),
          season_start_date: plan.season_start_date || '',
          season_end_date: plan.season_end_date || '',
          min_billing_days: String(plan.min_billing_days),
          is_active: plan.is_active,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params]);

  const set = (k: keyof FormData, v: string | boolean) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const isSeasonal = rateType === 'SEASONAL_PER_BAG';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        rate_amount_pkr: parseFloat(form.rate_amount_pkr),
        min_billing_days: parseInt(form.min_billing_days) || 1,
        is_active: form.is_active,
        commodity_id: form.commodity_id || null,
      };
      if (isSeasonal) {
        payload['season_start_date'] = form.season_start_date || null;
        payload['season_end_date'] = form.season_end_date || null;
      }
      await apiClient(`/v1/rate-plans/${params['id']}`, { method: 'PATCH', body: payload });
      toast.success('Rate plan updated');
      router.push('/billing/rate-plans');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rate plan');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!form) return <p className="text-destructive">Rate plan not found</p>;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Edit Rate Plan" crumb="Edit" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
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
                <Label>Rate Type</Label>
                <Input value={rateType.replace(/_/g, ' ')} disabled className="bg-muted text-muted-foreground" />
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
                    <Label>Season Start</Label>
                    <Input type="date" value={form.season_start_date} onChange={(e) => set('season_start_date', e.target.value)} className="tabular-nums" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Season End</Label>
                    <Input type="date" value={form.season_end_date} onChange={(e) => set('season_end_date', e.target.value)} className="tabular-nums" />
                  </div>
                </>
              )}
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={form.is_active} onCheckedChange={(c) => set('is_active', !!c)} />
              Active
            </label>
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save Changes'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
