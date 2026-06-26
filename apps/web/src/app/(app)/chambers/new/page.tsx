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
  commodity_restriction_id: '',
  max_capacity_bags: '',
  temperature_min_c: '',
  temperature_max_c: '',
  notes: '',
};
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function ChamberCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient<Commodity[]>('/v1/commodities').then(setCommodities).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        max_capacity_bags: parseInt(form.max_capacity_bags, 10),
      };
      if (form.commodity_restriction_id) payload['commodity_restriction_id'] = form.commodity_restriction_id;
      if (form.temperature_min_c !== '') payload['temperature_min_c'] = parseFloat(form.temperature_min_c);
      if (form.temperature_max_c !== '') payload['temperature_max_c'] = parseFloat(form.temperature_max_c);
      if (form.notes.trim()) payload['notes'] = form.notes.trim();
      await apiClient('/v1/chambers', { method: 'POST', body: payload });
      toast.success('Chamber created');
      router.push('/chambers');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create chamber');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Create Chamber" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                maxLength={100}
                placeholder="e.g. Chamber A1"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>
                  Capacity (bags) <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={form.max_capacity_bags}
                  onChange={(e) => set('max_capacity_bags', e.target.value)}
                  required
                  className="tabular-nums"
                  placeholder="e.g. 5000"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Commodity restriction</Label>
                <select
                  value={form.commodity_restriction_id}
                  onChange={(e) => set('commodity_restriction_id', e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">Any commodity</option>
                  {commodities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Min temp (°C)</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={-50}
                  max={50}
                  value={form.temperature_min_c}
                  onChange={(e) => set('temperature_min_c', e.target.value)}
                  className="tabular-nums"
                  placeholder="e.g. 2"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Max temp (°C)</Label>
                <Input
                  type="number"
                  step={0.1}
                  min={-50}
                  max={50}
                  value={form.temperature_max_c}
                  onChange={(e) => set('temperature_max_c', e.target.value)}
                  className="tabular-nums"
                  placeholder="e.g. 5"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Chamber'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
