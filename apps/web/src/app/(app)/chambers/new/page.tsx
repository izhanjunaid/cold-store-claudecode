'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

interface Commodity {
  id: string;
  name: string;
}

interface RackRow {
  name: string;
  capacity: string;
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

export default function RoomCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [racks, setRacks] = useState<RackRow[]>([]);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient<Commodity[]>('/v1/commodities').then(setCommodities).catch(() => {});
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const setRack = (idx: number, patch: Partial<RackRow>) =>
    setRacks((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const addRack = () =>
    setRacks((rows) => [...rows, { name: `R-${rows.length + 1}`, capacity: '' }]);

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
      const chamber = await apiClient<{ id: string }>('/v1/chambers', { method: 'POST', body: payload });

      const validRacks = racks.filter((r) => r.name.trim() && (parseInt(r.capacity) || 0) > 0);
      for (const [idx, rack] of validRacks.entries()) {
        await apiClient(`/v1/chambers/${chamber.id}/racks`, {
          method: 'POST',
          body: { name: rack.name.trim(), max_capacity_bags: parseInt(rack.capacity), position: idx },
        });
      }

      toast.success(validRacks.length > 0 ? `Room created with ${validRacks.length} racks` : 'Room created');
      router.push(`/chambers/${chamber.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <PageHeader title="Create Room" crumb="New" />
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <EntrySheet>
          <EntryGroup title="Room" columns={2}>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                maxLength={100}
                placeholder="e.g. Room A1"
              />
            </div>
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Input
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Optional"
              />
            </div>
          </EntryGroup>

          <EntryGroup title="Racks (optional)" columns={2}>
            <div className="col-span-full space-y-2">
              <p className="text-xs text-muted-foreground">
                Lay out the room&apos;s racks now — lots can then be placed rack-by-rack.
              </p>
              {racks.map((rack, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    value={rack.name}
                    onChange={(e) => setRack(idx, { name: e.target.value })}
                    placeholder="Rack name, e.g. R-1"
                    maxLength={50}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={rack.capacity}
                    onChange={(e) => setRack(idx, { capacity: e.target.value })}
                    placeholder="Capacity (bags)"
                    className="w-40 tabular-nums"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setRacks((rows) => rows.filter((_, i) => i !== idx))}
                    aria-label="Remove rack"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRack}>
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add rack
              </Button>
            </div>
          </EntryGroup>
        </EntrySheet>

        <FormActions>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Room'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
