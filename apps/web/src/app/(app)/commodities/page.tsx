'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

interface Commodity {
  id: string;
  name: string;
  unit_label: string;
  default_storage_days_alert: number | null;
}
interface Variety {
  id: string;
  name: string;
}

export default function CommoditiesPage() {
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [varieties, setVarieties] = useState<Record<string, Variety[]>>({});
  const [loading, setLoading] = useState(true);

  // add-commodity form
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('bags');
  const [alertDays, setAlertDays] = useState('');
  const [savingCommodity, setSavingCommodity] = useState(false);

  // per-commodity new-variety inputs
  const [varietyInput, setVarietyInput] = useState<Record<string, string>>({});
  const [savingVariety, setSavingVariety] = useState<string | null>(null);

  const loadVarieties = useCallback(async (id: string) => {
    try {
      const v = await apiClient<Variety[]>(`/v1/commodities/${id}/varieties`);
      setVarieties((prev) => ({ ...prev, [id]: v }));
    } catch {
      /* ignore */
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiClient<Commodity[]>('/v1/commodities');
      setCommodities(list);
      await Promise.all(list.map((c) => loadVarieties(c.id)));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [loadVarieties]);

  useEffect(() => {
    void load();
  }, [load]);

  const addCommodity = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCommodity(true);
    try {
      const payload: Record<string, unknown> = { name: name.trim(), unit_label: unit.trim() };
      if (alertDays !== '') payload['default_storage_days_alert'] = parseInt(alertDays, 10);
      await apiClient('/v1/commodities', { method: 'POST', body: payload });
      toast.success('Commodity added');
      setName('');
      setUnit('bags');
      setAlertDays('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add commodity');
    } finally {
      setSavingCommodity(false);
    }
  };

  const addVariety = async (commodityId: string) => {
    const vName = (varietyInput[commodityId] ?? '').trim();
    if (!vName) return;
    setSavingVariety(commodityId);
    try {
      await apiClient(`/v1/commodities/${commodityId}/varieties`, { method: 'POST', body: { name: vName } });
      setVarietyInput((prev) => ({ ...prev, [commodityId]: '' }));
      await loadVarieties(commodityId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add variety');
    } finally {
      setSavingVariety(null);
    }
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Commodities & Varieties"
        description="Produce types stored at the facility, and their varieties"
      />

      {/* Add commodity */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <form onSubmit={addCommodity} className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                Commodity name <span className="text-destructive">*</span>
              </Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="e.g. Potato" />
            </div>
            <div className="space-y-1.5">
              <Label>
                Unit <span className="text-destructive">*</span>
              </Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} required maxLength={20} placeholder="bags" />
            </div>
            <div className="space-y-1.5">
              <Label>Alert (days)</Label>
              <Input
                type="number"
                min={1}
                value={alertDays}
                onChange={(e) => setAlertDays(e.target.value)}
                className="tabular-nums"
                placeholder="—"
              />
            </div>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={savingCommodity}>
                <Plus className="h-4 w-4" aria-hidden />
                {savingCommodity ? 'Adding…' : 'Add Commodity'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List with inline variety management */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : commodities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No commodities yet. Add your first one above.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {commodities.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{c.name}</h3>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    unit: {c.unit_label}
                    {c.default_storage_days_alert ? ` · alert ${c.default_storage_days_alert}d` : ''}
                  </span>
                </div>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(varieties[c.id] ?? []).length === 0 ? (
                    <span className="text-sm text-muted-foreground">No varieties yet</span>
                  ) : (
                    (varieties[c.id] ?? []).map((v) => (
                      <span
                        key={v.id}
                        className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                      >
                        {v.name}
                      </span>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={varietyInput[c.id] ?? ''}
                    onChange={(e) => setVarietyInput((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void addVariety(c.id);
                      }
                    }}
                    placeholder="Add a variety (e.g. Lady Rosetta)"
                    maxLength={100}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={savingVariety === c.id}
                    onClick={() => addVariety(c.id)}
                  >
                    {savingVariety === c.id ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
