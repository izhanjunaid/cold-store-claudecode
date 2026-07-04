'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import type { CommodityInventoryRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { apiClient } from '@/lib/api-client';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

export default function CommodityInventoryPage() {
  const user = useAuthStore((s) => s.user);
  const canView = hasMinRole(user?.role, 'MANAGER');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<CommodityInventoryRowType[]>({
    queryKey: ['commodity-inventory', user?.facility_id],
    queryFn: () => apiClient<CommodityInventoryRowType[]>('/v1/reports/commodity-inventory'),
    enabled: canView && !!user,
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="Commodity Inventory" />
        <p className="text-muted-foreground">Commodity inventory requires MANAGER role or higher.</p>
      </div>
    );
  }

  const totalBags = data?.reduce((s, c) => s + c.total_bags, 0) ?? 0;

  return (
    <div>
      <PageHeader title="Commodity Inventory" description="Bags in storage by commodity, with per-chamber breakdown" />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Active Commodities</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{data?.length ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total Bags</div>
            <div className="mt-1 text-xl font-semibold tabular-nums">{totalBags.toLocaleString()}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        {isLoading ? (
          <div className="space-y-2.5 p-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No active inventory.</p>
        ) : (
          <ul className="divide-y">
            {data.map((row) => {
              const isOpen = expanded.has(row.commodity_id);
              return (
                <li key={row.commodity_id}>
                  <button
                    onClick={() => toggle(row.commodity_id)}
                    className="flex w-full items-center justify-between px-4 py-3 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2">
                      <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-90')} aria-hidden />
                      <span className="font-medium">{row.commodity_name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({row.per_chamber.length} chamber{row.per_chamber.length === 1 ? '' : 's'})
                      </span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{row.total_bags.toLocaleString()} bags</span>
                  </button>
                  {isOpen && (
                    <div className="bg-muted/30 px-4 py-2">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Chamber</TableHead>
                            <TableHead className="text-right">Bags</TableHead>
                            <TableHead className="text-right">Occupancy</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {row.per_chamber.map((c) => (
                            <TableRow key={c.chamber_id}>
                              <TableCell>{c.chamber_name}</TableCell>
                              <TableCell className="text-right tabular-nums">{c.bags.toLocaleString()}</TableCell>
                              <TableCell className="text-right tabular-nums">{c.occupancy_pct.toFixed(1)}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
