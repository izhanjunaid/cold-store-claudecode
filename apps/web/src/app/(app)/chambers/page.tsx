'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Map, Plus, Rows3 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { CapacityBar, capacityPct } from '@/components/capacity-bar';

interface Chamber {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  rack_count: number;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  last_temperature: { temperature_c: number } | null;
}

export default function RoomListPage() {
  const router = useRouter();
  const { data: chambers = [], isLoading: loading } = useQuery({
    queryKey: qk.chambers.list({}),
    queryFn: () => apiClient<Chamber[]>('/v1/chambers'),
  });

  return (
    <div>
      <PageHeader
        title="Rooms"
        description="Cold rooms, racks, capacity and temperature"
        actions={
          <>
            <Button variant="outline" onClick={() => router.push('/chambers/map')}>
              <Map className="h-4 w-4" aria-hidden />
              Map View
            </Button>
            <Button onClick={() => router.push('/chambers/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              Create Room
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
          <CardContent className="py-12 text-center text-muted-foreground">No rooms found</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {chambers.map((chamber) => {
            const pct = capacityPct(chamber.current_occupancy_bags, chamber.max_capacity_bags);
            return (
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
                      <span className="tabular-nums">{pct}%</span>
                    </div>
                    <CapacityBar occupied={chamber.current_occupancy_bags} capacity={chamber.max_capacity_bags} />
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Rows3 className="h-3.5 w-3.5" aria-hidden />
                      {chamber.rack_count > 0
                        ? `${chamber.rack_count} rack${chamber.rack_count === 1 ? '' : 's'}`
                        : 'No racks yet'}
                    </span>
                    {chamber.last_temperature ? (
                      <span className="font-medium tabular-nums">{chamber.last_temperature.temperature_c}°C</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No temp readings</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
