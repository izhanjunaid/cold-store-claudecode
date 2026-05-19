'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Chamber {
  id: string;
  name: string;
  commodity_restriction_id: string | null;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  available_capacity_bags: number;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  is_active: boolean;
  last_temperature: {
    temperature_c: number;
    recorded_at: string;
    source: string;
  } | null;
}

export default function ChamberListPage() {
  const router = useRouter();
  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient<Chamber[]>('/v1/chambers')
      .then(setChambers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getOccupancyColor = (chamber: Chamber) => {
    const pct = (chamber.current_occupancy_bags / chamber.max_capacity_bags) * 100;
    if (pct > 90) return 'bg-red-500';
    if (pct > 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getOccupancyPct = (chamber: Chamber) => {
    return Math.round((chamber.current_occupancy_bags / chamber.max_capacity_bags) * 100);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Chambers</h1>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/chambers/map')}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            Map View
          </button>
          <button
            onClick={() => router.push('/chambers/new')}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
          >
            Create Chamber
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500">Loading...</div>
      ) : chambers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">No chambers found</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chambers.map(chamber => (
            <div
              key={chamber.id}
              onClick={() => router.push(`/chambers/${chamber.id}`)}
              className="bg-white rounded-lg shadow p-5 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">{chamber.name}</h3>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  chamber.commodity_restriction_name
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {chamber.commodity_restriction_name || 'Multi'}
                </span>
              </div>

              {/* Capacity bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>{chamber.current_occupancy_bags.toLocaleString()} / {chamber.max_capacity_bags.toLocaleString()} bags</span>
                  <span>{getOccupancyPct(chamber)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${getOccupancyColor(chamber)}`}
                    style={{ width: `${getOccupancyPct(chamber)}%` }}
                  />
                </div>
              </div>

              {/* Temperature */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">
                  Range: {chamber.temperature_min_c ?? '?'}&deg;C - {chamber.temperature_max_c ?? '?'}&deg;C
                </span>
                {chamber.last_temperature ? (
                  <span className="font-medium text-gray-700">
                    {chamber.last_temperature.temperature_c}&deg;C
                  </span>
                ) : (
                  <span className="text-gray-400 text-xs">No readings</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
