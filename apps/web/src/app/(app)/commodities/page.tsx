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
  unit_name: string;
  unit_name_urdu: string | null;
  unit_weight_kg: number | null;
  space_factor: number;
  default_storage_days_alert: number | null;
}

/** The unit fields of one kind of goods, as typed on the form. */
interface UnitForm {
  unit_label: string;
  unit_name: string;
  unit_name_urdu: string;
  unit_weight_kg: string;
  space_factor: string;
}

const NEW_UNIT: UnitForm = { unit_label: 'Bags', unit_name: 'Bag', unit_name_urdu: 'بوری', unit_weight_kg: '', space_factor: '1' };

function unitPayload(f: UnitForm) {
  return {
    unit_label: f.unit_label.trim(),
    unit_name: f.unit_name.trim() || f.unit_label.trim(),
    unit_name_urdu: f.unit_name_urdu.trim() || null,
    unit_weight_kg: f.unit_weight_kg === '' ? null : Number(f.unit_weight_kg),
    space_factor: Number(f.space_factor) > 0 ? Number(f.space_factor) : 1,
  };
}

function UnitFields({ value, onChange }: { value: UnitForm; onChange: (v: UnitForm) => void }) {
  const set = (k: keyof UnitForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      <div className="space-y-1.5">
        <Label>
          Counted in <span className="text-destructive">*</span>
        </Label>
        <Input value={value.unit_label} onChange={set('unit_label')} required maxLength={20} placeholder="Bags" />
      </div>
      <div className="space-y-1.5">
        <Label>One of them</Label>
        <Input value={value.unit_name} onChange={set('unit_name')} maxLength={20} placeholder="Bag" />
      </div>
      <div className="space-y-1.5">
        <Label>In Urdu</Label>
        <Input value={value.unit_name_urdu} onChange={set('unit_name_urdu')} maxLength={40} dir="rtl" placeholder="بوری" />
      </div>
      <div className="space-y-1.5">
        <Label>Weight of one (kg)</Label>
        <Input type="number" min={0} step="0.01" value={value.unit_weight_kg} onChange={set('unit_weight_kg')} className="tabular-nums" placeholder="optional" />
      </div>
      <div className="space-y-1.5">
        <Label>Room one takes</Label>
        <Input
          type="number"
          min={0.001}
          step="0.001"
          value={value.space_factor}
          onChange={set('space_factor')}
          className="tabular-nums"
          title="1 for the goods your room capacity is counted in. A crate that takes half the room of a bag is 0.5."
        />
      </div>
    </>
  );
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
  const [unit, setUnit] = useState<UnitForm>(NEW_UNIT);
  // The goods whose unit is being edited, and the values typed.
  const [editing, setEditing] = useState<{ id: string; form: UnitForm } | null>(null);
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
      const payload: Record<string, unknown> = { name: name.trim(), ...unitPayload(unit) };
      if (alertDays !== '') payload['default_storage_days_alert'] = parseInt(alertDays, 10);
      await apiClient('/v1/commodities', { method: 'POST', body: payload });
      toast.success('Commodity added');
      setName('');
      setUnit(NEW_UNIT);
      setAlertDays('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add commodity');
    } finally {
      setSavingCommodity(false);
    }
  };

  const saveUnit = async () => {
    if (!editing) return;
    try {
      await apiClient(`/v1/commodities/${editing.id}`, { method: 'PATCH', body: unitPayload(editing.form) });
      toast.success('Unit saved');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the unit');
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
            <UnitFields value={unit} onChange={setUnit} />
            <div className="space-y-1.5">
              <Label>Storage alert (days)</Label>
              <Input
                type="number"
                min={1}
                value={alertDays}
                onChange={(e) => setAlertDays(e.target.value)}
                className="tabular-nums"
                placeholder="e.g. 120"
                title="Lot Aging flags lots stored longer than this"
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
                    counted in {c.unit_label}
                    {c.unit_name_urdu ? ` (${c.unit_name_urdu})` : ''}
                    {c.unit_weight_kg ? ` · ${c.unit_weight_kg} kg each` : ''}
                    {c.space_factor !== 1 ? ` · room ${c.space_factor}` : ''}
                    {c.default_storage_days_alert ? ` · alert ${c.default_storage_days_alert}d` : ''}
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="ml-1 h-auto p-0 text-xs"
                      onClick={() =>
                        setEditing({
                          id: c.id,
                          form: {
                            unit_label: c.unit_label,
                            unit_name: c.unit_name ?? '',
                            unit_name_urdu: c.unit_name_urdu ?? '',
                            unit_weight_kg: c.unit_weight_kg == null ? '' : String(c.unit_weight_kg),
                            space_factor: String(c.space_factor ?? 1),
                          },
                        })
                      }
                    >
                      Edit unit
                    </Button>
                  </span>
                </div>
                {editing?.id === c.id && (
                  <div className="mb-3 grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-5 sm:items-end">
                    <UnitFields value={editing.form} onChange={(form) => setEditing({ id: c.id, form })} />
                    <div className="flex gap-2 sm:col-span-5">
                      <Button type="button" size="sm" onClick={saveUnit}>Save unit</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
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
