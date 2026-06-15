'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

interface Chamber {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  last_temperature: { temperature_c: number } | null;
}
interface LotSummary {
  id: string;
  lot_number: string;
  owner_party_name?: string;
  commodity_name?: string;
  current_balance_bags: number;
}

function fillTier(pct: number) {
  if (pct >= 90) return { bg: 'bg-red-500', text: 'text-white', border: 'border-red-700', label: 'Full' };
  if (pct >= 70) return { bg: 'bg-amber-400', text: 'text-gray-900', border: 'border-amber-600', label: 'Busy' };
  if (pct > 0) return { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-700', label: 'Open' };
  return { bg: 'bg-secondary', text: 'text-muted-foreground', border: 'border-border', label: 'Empty' };
}

export default function ChamberMapPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = hasMinRole(user?.role, 'MANAGER');

  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    apiClient<Chamber[]>('/v1/chambers').then(setChambers).catch(() => {}).finally(() => setLoading(false));
  }, [canView]);

  async function openPopover(chamberId: string) {
    setSelectedId(chamberId);
    setLotsLoading(true);
    try {
      const res = await apiClient<{ data: LotSummary[] } | LotSummary[]>(`/v1/lots?chamber_id=${chamberId}&status=ACTIVE&per_page=200`);
      setLots(Array.isArray(res) ? res : res.data ?? []);
    } catch {
      setLots([]);
    } finally {
      setLotsLoading(false);
    }
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="Chamber Map" />
        <p className="text-muted-foreground">Chamber map requires MANAGER role or higher.</p>
      </div>
    );
  }

  const selected = chambers.find((c) => c.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Chamber Map"
        description="Fill-level overview across all cold rooms"
        actions={
          <Button variant="outline" onClick={() => router.push('/chambers')}>
            Back to list
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-4 py-3 text-xs">
          <span className="font-medium text-muted-foreground">Fill level:</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-emerald-500" /> Open (1–69%)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-amber-400" /> Busy (70–89%)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-red-500" /> Full (90%+)</span>
          <span className="flex items-center gap-2"><span className="h-3 w-3 rounded border bg-secondary" /> Empty</span>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : chambers.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No chambers configured.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {chambers.map((c) => {
            const pct = c.max_capacity_bags > 0 ? Math.round((c.current_occupancy_bags / c.max_capacity_bags) * 100) : 0;
            const tier = fillTier(pct);
            return (
              <button
                key={c.id}
                onClick={() => openPopover(c.id)}
                className={cn(
                  'relative flex aspect-square flex-col justify-between rounded-lg border-2 p-3 text-left transition-opacity hover:opacity-90',
                  tier.border,
                  tier.bg,
                  tier.text,
                  selectedId === c.id && 'ring-2 ring-ring ring-offset-2',
                )}
              >
                <div>
                  <div className="text-base font-semibold">{c.name}</div>
                  <div className="mt-0.5 text-xs opacity-90">{c.commodity_restriction_name ?? 'Multi'}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold leading-none tabular-nums">{pct}%</div>
                  <div className="mt-1 text-xs opacity-90 tabular-nums">
                    {c.current_occupancy_bags.toLocaleString()} / {c.max_capacity_bags.toLocaleString()} bags
                  </div>
                  <div className="mt-0.5 text-xs opacity-80">{tier.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
          </DialogHeader>
          {selected && (
            <>
              <p className="text-sm text-muted-foreground">
                {selected.current_occupancy_bags.toLocaleString()} of {selected.max_capacity_bags.toLocaleString()} bags
                {selected.last_temperature && <span className="ml-2">· {selected.last_temperature.temperature_c}°C</span>}
              </p>
              <div className="max-h-[50vh] overflow-y-auto">
                {lotsLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Loading lots…</p>
                ) : lots.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No active lots in this chamber.</p>
                ) : (
                  <ul className="divide-y">
                    {lots.map((lot) => (
                      <li key={lot.id} className="flex items-center gap-3 py-2 text-sm">
                        <Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => router.push(`/lots/${lot.id}`)}>
                          {lot.lot_number}
                        </Button>
                        <span className="text-muted-foreground">{lot.owner_party_name ?? '—'}</span>
                        <span className="text-muted-foreground">{lot.commodity_name ?? '—'}</span>
                        <span className="ml-auto font-medium tabular-nums">{lot.current_balance_bags.toLocaleString()} bags</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => selected && router.push(`/chambers/${selected.id}`)}>
              Chamber Details
            </Button>
            <Button onClick={() => setSelectedId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
