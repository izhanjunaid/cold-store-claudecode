'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { CommodityInventoryRowType } from '@coldchain/shared';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

export default function CommodityInventoryPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['MANAGER']!;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<CommodityInventoryRowType[]>({
    queryKey: ['commodity-inventory', user?.facility_id],
    queryFn: () => apiClient<CommodityInventoryRowType[]>('/v1/reports/commodity-inventory'),
    enabled: canView && !!user,
  });

  function toggle(commodityId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(commodityId)) next.delete(commodityId);
      else next.add(commodityId);
      return next;
    });
  }

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Commodity inventory requires MANAGER role or higher.</p>
      </div>
    );
  }

  const totalBags = data?.reduce((s, c) => s + c.total_bags, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Commodity Inventory</h1>
        <button
          onClick={() => router.push('/reports')}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to reports
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-6">
        <div>
          <div className="text-xs text-gray-500 uppercase">Active Commodities</div>
          <div className="text-xl font-semibold">{data?.length ?? 0}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase">Total Bags in Storage</div>
          <div className="text-xl font-semibold">{totalBags.toLocaleString()}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No active inventory.</div>
        ) : (
          <ul className="divide-y">
            {data.map((row) => {
              const isOpen = expanded.has(row.commodity_id);
              return (
                <li key={row.commodity_id}>
                  <button
                    onClick={() => toggle(row.commodity_id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400">{isOpen ? '▼' : '▶'}</span>
                      <span className="font-medium text-gray-900">{row.commodity_name}</span>
                      <span className="text-xs text-gray-500">
                        ({row.per_chamber.length} chamber{row.per_chamber.length === 1 ? '' : 's'})
                      </span>
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {row.total_bags.toLocaleString()} bags
                    </span>
                  </button>
                  {isOpen && (
                    <div className="bg-gray-50 px-4 py-2">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs uppercase text-gray-500">
                            <th className="text-left py-1">Chamber</th>
                            <th className="text-right">Bags</th>
                            <th className="text-right">Occupancy</th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.per_chamber.map((c) => (
                            <tr key={c.chamber_id}>
                              <td className="py-1">{c.chamber_name}</td>
                              <td className="text-right">{c.bags.toLocaleString()}</td>
                              <td className="text-right">{c.occupancy_pct.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
