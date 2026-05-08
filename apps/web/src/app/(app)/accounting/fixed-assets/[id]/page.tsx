'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

interface ScheduleRow {
  period_year: number;
  period_month: number;
  opening_nbv_pkr: number;
  depreciation_amount_pkr: number;
  closing_nbv_pkr: number;
  status: string;
  posted_at: string | null;
}

interface FixedAsset {
  id: string;
  asset_number: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  purchase_cost_pkr: number;
  residual_value_pkr: number;
  useful_life_years: number | null;
  wdv_rate_percent: number | null;
  depreciation_method: string;
  depreciation_start_date: string | null;
  status: string;
  accumulated_depreciation_pkr: number;
  net_book_value_pkr: number;
  asset_account_code: string;
  accum_depr_account_code: string;
  depr_expense_account_code: string;
  disposal_date: string | null;
  disposal_proceeds_pkr: number | null;
  purchase_journal_entry_id: string | null;
  disposal_journal_entry_id: string | null;
  book_type: string;
  notes: string | null;
  schedules: ScheduleRow[];
}

const STATUS_COLORS: Record<string, string> = {
  PURCHASED: 'bg-blue-100 text-blue-800',
  IN_SERVICE: 'bg-green-100 text-green-800',
  DISPOSED: 'bg-red-100 text-red-800',
  WRITTEN_OFF: 'bg-red-100 text-red-800',
};

export default function FixedAssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isOwner = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 4;

  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCommission, setShowCommission] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [commissionDate, setCommissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalProceeds, setDisposalProceeds] = useState('');

  const fetchAsset = useCallback(async () => {
    setLoading(true);
    try {
      const a = await apiClient<FixedAsset>(`/v1/fixed-assets/${id}`);
      setAsset(a);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAsset(); }, [fetchAsset]);

  async function commission() {
    setActionError(null);
    try {
      await apiClient(`/v1/fixed-assets/${id}/commission`, {
        method: 'POST',
        body: { depreciation_start_date: commissionDate },
      });
      setShowCommission(false);
      fetchAsset();
    } catch (e: any) { setActionError(e.message); }
  }

  async function dispose() {
    setActionError(null);
    try {
      await apiClient(`/v1/fixed-assets/${id}/dispose`, {
        method: 'POST',
        body: {
          disposal_date: disposalDate,
          disposal_proceeds_pkr: Number(disposalProceeds),
        },
      });
      setShowDispose(false);
      fetchAsset();
    } catch (e: any) { setActionError(e.message); }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!asset) return <div className="p-8 text-red-700">Asset not found</div>;

  return (
    <div>
      <button onClick={() => router.push('/accounting/fixed-assets')} className="text-sm text-blue-600 hover:underline mb-4">← Back to assets</button>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-sm text-gray-500">{asset.asset_number}</div>
            <h1 className="text-2xl font-bold text-gray-900">{asset.asset_name}</h1>
            <div className="text-sm text-gray-600 mt-1">
              {asset.asset_category} · Purchased {asset.purchase_date}
              {asset.depreciation_start_date && ` · In service since ${asset.depreciation_start_date}`}
            </div>
          </div>
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${STATUS_COLORS[asset.status]}`}>{asset.status}</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div>
            <div className="text-xs text-gray-500 uppercase">Purchase Cost</div>
            <div className="text-lg font-semibold">Rs. {asset.purchase_cost_pkr.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Accum. Depreciation</div>
            <div className="text-lg font-semibold text-orange-700">Rs. {asset.accumulated_depreciation_pkr.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Net Book Value</div>
            <div className="text-lg font-semibold text-green-700">Rs. {asset.net_book_value_pkr.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase">Depreciation</div>
            <div className="text-lg font-semibold">{asset.depreciation_method} {asset.wdv_rate_percent ? `${asset.wdv_rate_percent}%` : `${asset.useful_life_years}yr`}</div>
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-600 space-y-1">
          <div>Asset account: <span className="font-mono">{asset.asset_account_code}</span> · Accum. depr.: <span className="font-mono">{asset.accum_depr_account_code}</span> · Expense: <span className="font-mono">{asset.depr_expense_account_code}</span></div>
          {asset.purchase_journal_entry_id && (
            <div>Purchase JE: <button onClick={() => router.push(`/accounting/journal-entries/${asset.purchase_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{asset.purchase_journal_entry_id.slice(0, 8)}…</button></div>
          )}
          {asset.disposal_journal_entry_id && (
            <div>Disposal JE: <button onClick={() => router.push(`/accounting/journal-entries/${asset.disposal_journal_entry_id}`)} className="text-blue-600 hover:underline font-mono">{asset.disposal_journal_entry_id.slice(0, 8)}…</button></div>
          )}
          {asset.notes && <div>Notes: {asset.notes}</div>}
        </div>

        {isOwner && asset.status === 'PURCHASED' && (
          <button onClick={() => setShowCommission(true)} className="mt-4 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Commission Asset (PURCHASED → IN_SERVICE)</button>
        )}
        {isOwner && (asset.status === 'PURCHASED' || asset.status === 'IN_SERVICE') && (
          <button onClick={() => setShowDispose(true)} className="mt-4 ml-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">Dispose Asset (post JE-14)</button>
        )}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-3 border-b">
          <h2 className="font-semibold">Depreciation Schedule</h2>
          <p className="text-xs text-gray-500">Posted entries from monthly depreciation runs.</p>
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Opening NBV</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Depreciation</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Closing NBV</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Posted At</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {asset.schedules.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No depreciation runs yet</td></tr>
            ) : (
              asset.schedules.map((s) => (
                <tr key={`${s.period_year}-${s.period_month}`}>
                  <td className="px-4 py-3 text-sm font-mono">{s.period_year}-{String(s.period_month).padStart(2, '0')}</td>
                  <td className="px-4 py-3 text-sm text-right">{s.opening_nbv_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right text-orange-700">{s.depreciation_amount_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{s.closing_nbv_pkr.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{s.posted_at?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showCommission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Commission Asset</h3>
            <p className="text-sm text-gray-600 mb-3">Sets status to IN_SERVICE and starts depreciation accrual.</p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Depreciation Start Date</label>
            <input type="date" value={commissionDate} onChange={(e) => setCommissionDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-4" />
            {actionError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mb-3">{actionError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCommission(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={commission} className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700">Commission</button>
            </div>
          </div>
        </div>
      )}

      {showDispose && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Dispose Asset</h3>
            <p className="text-sm text-gray-600 mb-3">
              Current NBV: Rs. {asset.net_book_value_pkr.toLocaleString()}. Posts JE-14 with gain (4230) or loss (6110) vs proceeds.
            </p>
            <label className="block text-sm font-medium text-gray-700 mb-1">Disposal Date</label>
            <input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-3" />
            <label className="block text-sm font-medium text-gray-700 mb-1">Proceeds (PKR)</label>
            <input type="number" min="0" step="0.01" value={disposalProceeds} onChange={(e) => setDisposalProceeds(e.target.value)} className="w-full border rounded-lg px-3 py-2 mb-4" placeholder="0 if scrapped" />
            {actionError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mb-3">{actionError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDispose(false)} className="border border-gray-300 px-4 py-2 rounded-lg">Cancel</button>
              <button onClick={dispose} className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700">Dispose</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
