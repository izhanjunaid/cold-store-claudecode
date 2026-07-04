'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Map, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

interface Chamber {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  last_temperature: { temperature_c: number } | null;
}

export default function ChamberListPage() {
  const router = useRouter();
  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<Chamber[]>('/v1/chambers').then(setChambers).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const pct = (c: Chamber) => Math.round((c.current_occupancy_bags / c.max_capacity_bags) * 100);
  const barColor = (c: Chamber) => {
    const p = pct(c);
    if (p > 90) return 'bg-destructive';
    if (p > 75) return 'bg-warning';
    return 'bg-primary';
  };

  return (
    <div>
      <PageHeader
        title="Chambers"
        description="Cold rooms, capacity and temperature"
        actions={
          <>
            <Button variant="outline" onClick={() => router.push('/chambers/map')}>
              <Map className="h-4 w-4" aria-hidden />
              Map View
            </Button>
            <Button onClick={() => router.push('/chambers/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Create Chamber
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-lg" />
          ))}
        </div>
      ) : chambers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">No chambers found</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {chambers.map((chamber) => (
            <Card key={chamber.id} className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => router.push(`/chambers/${chamber.id}`)}>
              <CardContent className="pt-6">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h3 className="min-w-0 font-semibold text-foreground">{chamber.name}</h3>
                  <StatusBadge
                    status={chamber.commodity_restriction_name || 'Multi'}
                    tone={chamber.commodity_restriction_name ? 'info' : 'neutral'}
                    raw
                    className="shrink-0"
                  />
                </div>
                <div className="mb-3">
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {chamber.current_occupancy_bags.toLocaleString()} / {chamber.max_capacity_bags.toLocaleString()} bags
                    </span>
                    <span className="tabular-nums">{pct(chamber)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div className={cn('h-2 rounded-full', barColor(chamber))} style={{ width: `${Math.min(100, pct(chamber))}%` }} />
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {chamber.temperature_min_c == null && chamber.temperature_max_c == null
                      ? 'Temp range not set'
                      : `Range: ${chamber.temperature_min_c ?? '—'}°C – ${chamber.temperature_max_c ?? '—'}°C`}
                  </span>
                  {chamber.last_temperature ? (
                    <span className="font-medium tabular-nums">{chamber.last_temperature.temperature_c}°C</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No temperature readings yet</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
