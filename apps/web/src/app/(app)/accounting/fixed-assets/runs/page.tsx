'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

interface RunSummary {
  period_year: number;
  period_month: number;
  asset_count: number;
  total_depreciation_pkr: number;
}

interface RunResult {
  period_year: number;
  period_month: number;
  run_count: number;
  total_depreciation_pkr: number;
  entries: { asset_number: string; depreciation_amount_pkr: number; journal_entry_id: string }[];
}

export default function DepreciationRunsPage() {
  const { user } = useAuthStore();
  const isOwner = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runYear, setRunYear] = useState(new Date().getFullYear());
  const [runMonth, setRunMonth] = useState(new Date().getMonth() + 1);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<RunSummary[]>(`/v1/depreciation/runs`);
      setRuns(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function executeRun() {
    setRunError(null);
    setRunning(true);
    try {
      const result = await apiClient<RunResult>(`/v1/depreciation/runs`, {
        method: 'POST',
        body: { period_year: runYear, period_month: runMonth },
      });
      setLastResult(result);
      setShowRunModal(false);
      fetchRuns();
    } catch (e: any) {
      setRunError(e.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Depreciation Runs</h1>
        {isOwner && (
          <button onClick={() => setShowRunModal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            + Run Month
          </button>
        )}
      </div>

      {lastResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="font-semibold text-green-900">
            Run posted for {lastResult.period_year}-{String(lastResult.period_month).padStart(2, '0')}
          </div>
          <div className="text-sm text-green-800 mt-1">
            {lastResult.run_count} asset(s), total depreciation Rs. {lastResult.total_depreciation_pkr.toLocaleString()}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Asset Count</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total Depreciation (PKR)</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : runs.length === 0 ? (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-500">No depreciation runs yet</td></tr>
            ) : (
              runs.map((r) => (
                <tr key={`${r.period_year}-${r.period_month}`}>
                  <td className="px-4 py-3 text-sm font-mono">{r.period_year}-{String(r.period_month).padStart(2, '0')}</td>
                  <td className="px-4 py-3 text-sm text-right">{r.asset_count}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{r.total_depreciation_pkr.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showRunModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Run Monthly Depreciation</h3>
            <p className="text-sm text-gray-600 mb-4">
              Posts JE-13 for every IN_SERVICE asset in the selected period. Idempotent — re-runs for the same period are rejected.
            </p>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <input type="number" value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2" min={2020} max={2100} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                <select value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m} — {new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                  ))}
                </select>
              </div>
            </div>
            {runError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mb-3">{runError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowRunModal(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={executeRun} disabled={running} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {running ? 'Running...' : 'Post JE-13 Batch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
