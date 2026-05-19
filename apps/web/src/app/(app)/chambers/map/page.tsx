'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface Chamber {
  id: string;
  name: string;
  commodity_restriction_id: string | null;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  available_capacity_bags: number;
  is_active: boolean;
  last_temperature: {
    temperature_c: number;
    recorded_at: string;
  } | null;
}

interface LotSummary {
  id: string;
  lot_number: string;
  owner_party_name?: string;
  commodity_name?: string;
  current_balance_bags: number;
}

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

function fillTier(pct: number) {
  if (pct >= 90) return { bg: 'bg-red-500', text: 'text-white', border: 'border-red-700', label: 'Full' };
  if (pct >= 70) return { bg: 'bg-amber-400', text: 'text-gray-900', border: 'border-amber-600', label: 'Busy' };
  if (pct > 0) return { bg: 'bg-emerald-500', text: 'text-white', border: 'border-emerald-700', label: 'Open' };
  return { bg: 'bg-gray-200', text: 'text-gray-500', border: 'border-gray-300', label: 'Empty' };
}

export default function ChamberMapPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = (ROLE_RANK[user?.role ?? ''] ?? 0) >= ROLE_RANK['MANAGER']!;

  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);

  useEffect(() => {
    if (!canView) return;
    apiClient<Chamber[]>('/v1/chambers')
      .then(setChambers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [canView]);

  async function openPopover(chamberId: string) {
    setSelectedId(chamberId);
    setLotsLoading(true);
    try {
      const res = await apiClient<{ data: LotSummary[] } | LotSummary[]>(
        `/v1/lots?chamber_id=${chamberId}&status=ACTIVE&per_page=200`,
      );
      const list = Array.isArray(res) ? res : (res.data ?? []);
      setLots(list);
    } catch {
      setLots([]);
    } finally {
      setLotsLoading(false);
    }
  }

  if (!canView) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Chamber map requires MANAGER role or higher.</p>
      </div>
    );
  }

  const selected = chambers.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Chamber Map</h1>
        <button
          onClick={() => router.push('/chambers')}
          className="text-sm text-blue-600 hover:underline"
        >
          ← Back to list
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-medium text-gray-600">Fill level:</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-emerald-500"></span> Open (1–69%)</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-400"></span> Busy (70–89%)</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-red-500"></span> Full (90%+)</span>
        <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-gray-200 border"></span> Empty</span>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading…</div>
      ) : chambers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No chambers configured.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {chambers.map((c) => {
            const pct = c.max_capacity_bags > 0
              ? Math.round((c.current_occupancy_bags / c.max_capacity_bags) * 100)
              : 0;
            const tier = fillTier(pct);
            const active = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => openPopover(c.id)}
                className={`relative aspect-square rounded-lg border-2 ${tier.border} ${tier.bg} ${tier.text} p-3 flex flex-col justify-between text-left hover:opacity-90 transition-opacity ${active ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
              >
                <div>
                  <div className="font-semibold text-base">{c.name}</div>
                  <div className="text-xs opacity-90 mt-0.5">{c.commodity_restriction_name ?? 'Multi'}</div>
                </div>
                <div>
                  <div className="text-2xl font-bold leading-none">{pct}%</div>
                  <div className="text-xs opacity-90 mt-1">
                    {c.current_occupancy_bags.toLocaleString()} / {c.max_capacity_bags.toLocaleString()} bags
                  </div>
                  <div className="text-xs opacity-80 mt-0.5">{tier.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4" onClick={() => setSelectedId(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <div>
                <h2 className="font-bold text-gray-900">{selected.name}</h2>
                <p className="text-xs text-gray-500">
                  {selected.current_occupancy_bags.toLocaleString()} of {selected.max_capacity_bags.toLocaleString()} bags
                  {selected.last_temperature && (
                    <span className="ml-2">· {selected.last_temperature.temperature_c}°C</span>
                  )}
                </p>
              </div>
              <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {lotsLoading ? (
                <div className="text-center text-gray-500 py-6">Loading lots…</div>
              ) : lots.length === 0 ? (
                <div className="text-center text-gray-500 py-6">No active lots in this chamber.</div>
              ) : (
                <ul className="divide-y">
                  {lots.map((lot) => (
                    <li key={lot.id} className="py-2 flex items-center gap-3 text-sm">
                      <button
                        onClick={() => router.push(`/lots/${lot.id}`)}
                        className="font-mono text-xs text-blue-700 hover:underline"
                      >
                        {lot.lot_number}
                      </button>
                      <span className="text-gray-600">{lot.owner_party_name ?? '—'}</span>
                      <span className="text-gray-500">{lot.commodity_name ?? '—'}</span>
                      <span className="ml-auto font-medium">{lot.current_balance_bags.toLocaleString()} bags</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button
                onClick={() => router.push(`/chambers/${selected.id}`)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
              >
                Chamber Details
              </button>
              <button
                onClick={() => setSelectedId(null)}
                className="px-3 py-1.5 text-sm bg-gray-900 text-white rounded hover:bg-gray-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
