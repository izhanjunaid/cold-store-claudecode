'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface TemperatureLog {
  id: string;
  temperature_c: number;
  recorded_at: string;
  recorded_by_name?: string;
  source: string;
}

interface ChamberDetail {
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
  notes: string | null;
  last_temperature: { temperature_c: number; recorded_at: string; source: string } | null;
  temperature_logs: TemperatureLog[];
}

export default function ChamberDetailPage() {
  const params = useParams();
  const [chamber, setChamber] = useState<ChamberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tempInput, setTempInput] = useState('');
  const [loggingTemp, setLoggingTemp] = useState(false);

  const fetchChamber = () => {
    apiClient<ChamberDetail>(`/v1/chambers/${params['id']}`)
      .then(setChamber)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchChamber(); }, [params['id']]);

  const handleLogTemp = async () => {
    if (!tempInput) return;
    setLoggingTemp(true);
    try {
      await apiClient(`/v1/chambers/${params['id']}/temperature`, {
        method: 'POST',
        body: { temperature_c: parseFloat(tempInput), source: 'MANUAL' },
      });
      setTempInput('');
      fetchChamber();
    } catch {
      // handled
    } finally {
      setLoggingTemp(false);
    }
  };

  if (loading) return <div className="text-gray-500 p-6">Loading...</div>;
  if (!chamber) return <div className="text-red-500 p-6">Chamber not found</div>;

  const occupancyPct = Math.round((chamber.current_occupancy_bags / chamber.max_capacity_bags) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/chambers" className="text-sm text-primary-600 hover:underline mb-1 block">Back to Chambers</Link>
          <h1 className="text-2xl font-bold text-gray-900">{chamber.name}</h1>
        </div>
      </div>

      {/* Info + Occupancy */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-4">Chamber Info</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Commodity</dt>
              <dd className="text-sm text-gray-900">{chamber.commodity_restriction_name || 'Multi-commodity'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Capacity</dt>
              <dd className="text-sm text-gray-900">{chamber.max_capacity_bags.toLocaleString()} bags</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Temp Range</dt>
              <dd className="text-sm text-gray-900">{chamber.temperature_min_c ?? '?'}&deg;C - {chamber.temperature_max_c ?? '?'}&deg;C</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${chamber.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {chamber.is_active ? 'Active' : 'Inactive'}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-4">Occupancy</h2>
          <div className="text-center mb-4">
            <span className="text-4xl font-bold text-gray-900">{occupancyPct}%</span>
            <p className="text-sm text-gray-500 mt-1">
              {chamber.current_occupancy_bags.toLocaleString()} / {chamber.max_capacity_bags.toLocaleString()} bags
            </p>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full ${occupancyPct > 90 ? 'bg-red-500' : occupancyPct > 75 ? 'bg-yellow-500' : 'bg-green-500'}`}
              style={{ width: `${occupancyPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-3">Active lots table will populate in Phase 2</p>
        </div>
      </div>

      {/* Temperature Log */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-500 uppercase">Temperature History</h2>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              step="0.1"
              placeholder="Temp &deg;C"
              value={tempInput}
              onChange={(e) => setTempInput((e.target as HTMLInputElement).value)}
              className="border rounded-lg px-3 py-1.5 text-sm w-28"
            />
            <button
              onClick={handleLogTemp}
              disabled={loggingTemp || !tempInput}
              className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
            >
              {loggingTemp ? 'Logging...' : 'Log Temp'}
            </button>
          </div>
        </div>

        {chamber.temperature_logs.length === 0 ? (
          <p className="text-sm text-gray-400">No temperature readings recorded yet.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date/Time</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Temperature</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Recorded By</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {chamber.temperature_logs.map(log => {
                const inRange = chamber.temperature_min_c !== null && chamber.temperature_max_c !== null
                  ? log.temperature_c >= chamber.temperature_min_c && log.temperature_c <= chamber.temperature_max_c
                  : true;
                return (
                  <tr key={log.id}>
                    <td className="px-4 py-2 text-sm text-gray-600">{new Date(log.recorded_at).toLocaleString()}</td>
                    <td className={`px-4 py-2 text-sm font-medium ${inRange ? 'text-green-700' : 'text-red-700'}`}>
                      {log.temperature_c}&deg;C
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{log.recorded_by_name || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{log.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {chamber.notes && (
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-2">Notes</h2>
          <p className="text-sm text-gray-700">{chamber.notes}</p>
        </div>
      )}
    </div>
  );
}
