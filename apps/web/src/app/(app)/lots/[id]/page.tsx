'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface Lot {
  id: string;
  lot_number: string;
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED';
  owner_party_id: string;
  owner_party_name: string | null;
  billing_party_id: string;
  billing_party_name: string | null;
  commodity_id: string;
  commodity_name: string | null;
  variety_id: string | null;
  variety_name: string | null;
  chamber_id: string;
  chamber_name: string | null;
  rate_plan_id: string;
  rate_plan_name: string | null;
  quantity_bags: number;
  current_balance_bags: number;
  accepted_weight_kg: number;
  declared_weight_kg: number | null;
  weight_dispute_flag: boolean;
  weight_dispute_note: string | null;
  quality_grade_inbound: string | null;
  inbound_date: string;
  entry_date: string;
  vehicle_number: string | null;
  book_type: string;
  notes: string | null;
  days_in_storage: number;
  closed_at: string | null;
  created_at: string;
}

interface OwnershipEvent {
  id: string;
  event_type: string;
  from_party_name: string | null;
  to_party_name: string | null;
  quantity_bags: number;
  transfer_price_pkr: number | null;
  effective_date: string;
  operator_name: string | null;
  notes: string | null;
}

interface OutboundSummary {
  id: string;
  dispatch_note_number: string | null;
  withdrawal_type: string;
  quantity_withdrawn_bags: number;
  status: string;
  outbound_date: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-100 text-gray-800',
  SUSPENDED: 'bg-yellow-100 text-yellow-800',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  INITIAL: 'Initial Inbound',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
};

type Tab = 'overview' | 'ownership' | 'inspections' | 'withdrawals' | 'billing';

export default function LotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params['id'] as string;
  const recentTransferId = searchParams?.get('transfer');

  const [lot, setLot] = useState<Lot | null>(null);
  const [ownershipHistory, setOwnershipHistory] = useState<OwnershipEvent[]>([]);
  const [outboundEvents, setOutboundEvents] = useState<OutboundSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const canTransfer = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const canWithdraw =
    user?.role != null &&
    ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR'].includes(user.role);

  const fetchLot = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<Lot>(`/v1/lots/${id}`);
      setLot(res);
    } catch {
      // handled by null check
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchLot(); }, [fetchLot]);

  useEffect(() => {
    if (activeTab === 'ownership' && ownershipHistory.length === 0) {
      apiClient<OwnershipEvent[]>(`/v1/lots/${id}/ownership-history`)
        .then(setOwnershipHistory)
        .catch(() => {});
    }
    if (activeTab === 'withdrawals' && outboundEvents.length === 0) {
      apiClient<OutboundSummary[]>(`/v1/lots/${id}/outbound-events`)
        .then(setOutboundEvents)
        .catch(() => {});
    }
  }, [activeTab, id, ownershipHistory.length, outboundEvents.length]);

  // When landing with ?transfer= (post-transfer redirect), switch to the Ownership tab
  useEffect(() => {
    if (recentTransferId) setActiveTab('ownership');
  }, [recentTransferId]);

  const handlePrintReceipt = async () => {
    setReceiptLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/lots/${id}/receipt`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to fetch receipt');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      // handled silently
    } finally {
      setReceiptLoading(false);
    }
  };

  if (loading) return <div className="text-gray-500 p-6">Loading...</div>;
  if (!lot) return (
    <div className="p-6">
      <p className="text-red-600 mb-4">Lot not found.</p>
      <button onClick={() => router.push('/lots')} className="text-primary-600 hover:underline text-sm">
        Back to Lots
      </button>
    </div>
  );

  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'ownership', label: 'Ownership History' },
    { key: 'inspections', label: 'Inspections' },
    { key: 'withdrawals', label: 'Withdrawals' },
    { key: 'billing', label: 'Billing' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/lots')} className="text-gray-400 hover:text-gray-600">
            &#8592;
          </button>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{lot.lot_number}</h1>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[lot.status] || ''}`}>
            {lot.status}
          </span>
          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-700">
            {lot.book_type}
          </span>
        </div>
        <div className="flex gap-2">
          {canTransfer && lot.status === 'ACTIVE' && lot.current_balance_bags > 0 && (
            <button
              onClick={() => router.push(`/lots/${id}/transfer/new`)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700"
            >
              Transfer Ownership
            </button>
          )}
          {canWithdraw && lot.status === 'ACTIVE' && lot.current_balance_bags > 0 && (
            <button
              onClick={() => router.push(`/lots/${id}/withdraw`)}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
            >
              New Withdrawal
            </button>
          )}
          <button
            onClick={handlePrintReceipt}
            disabled={receiptLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {receiptLoading ? 'Loading...' : 'Print Receipt'}
          </button>
        </div>
      </div>

      {recentTransferId && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <p className="text-sm text-green-800">Transfer completed successfully.</p>
          <button
            onClick={() => router.push(`/lots/${id}/transfer/${recentTransferId}/acknowledgment`)}
            className="text-sm font-medium text-green-800 underline hover:no-underline"
          >
            View / Print Acknowledgment
          </button>
        </div>
      )}

      {/* Header Card */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        {lot.weight_dispute_flag && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm font-medium text-yellow-800">Weight Dispute Flag</p>
            {lot.weight_dispute_note && (
              <p className="text-xs text-yellow-700 mt-1">{lot.weight_dispute_note}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Owner</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{lot.owner_party_name ?? '—'}</p>
            {lot.billing_party_id !== lot.owner_party_id && (
              <p className="text-xs text-gray-500 mt-0.5">Billed to: {lot.billing_party_name}</p>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Commodity</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {lot.commodity_name ?? '—'}
              {lot.variety_name && <span className="text-gray-500"> / {lot.variety_name}</span>}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Chamber</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{lot.chamber_name ?? '—'}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Rate Plan</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{lot.rate_plan_name ?? '—'}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Bags (Balance / Original)</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {lot.current_balance_bags.toLocaleString()}
              <span className="text-gray-400"> / {lot.quantity_bags.toLocaleString()}</span>
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Weight (Accepted / Declared)</p>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {lot.accepted_weight_kg.toLocaleString()} kg
              {lot.declared_weight_kg != null && (
                <span className="text-gray-400"> / {lot.declared_weight_kg.toLocaleString()} kg</span>
              )}
            </p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Inbound Date</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{lot.inbound_date}</p>
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Days in Storage</p>
            <p className="text-sm font-medium text-gray-900 mt-1">{lot.days_in_storage}</p>
          </div>

          {lot.vehicle_number && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Vehicle</p>
              <p className="text-sm font-medium text-gray-900 mt-1">{lot.vehicle_number}</p>
            </div>
          )}

          {lot.quality_grade_inbound && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Quality Grade</p>
              <p className="text-sm font-medium text-gray-900 mt-1">Grade {lot.quality_grade_inbound}</p>
            </div>
          )}

          {lot.closed_at && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Closed At</p>
              <p className="text-sm font-medium text-gray-900 mt-1">{lot.closed_at}</p>
            </div>
          )}
        </div>

        {lot.notes && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notes</p>
            <p className="text-sm text-gray-700">{lot.notes}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="border-b flex">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                <div>
                  <span className="text-gray-500">Entry Date:</span>{' '}
                  <span className="text-gray-900">{lot.entry_date}</span>
                </div>
                <div>
                  <span className="text-gray-500">Created:</span>{' '}
                  <span className="text-gray-900">{new Date(lot.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500">Book Type:</span>{' '}
                  <span className="text-gray-900">{lot.book_type === 'PACCI' ? 'Pacci (Official)' : 'Katchi (Informal)'}</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ownership' && (
            <div>
              {ownershipHistory.length === 0 ? (
                <p className="text-gray-500 text-sm">No ownership history.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Event</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">From</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">To</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500 uppercase">Bags</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500 uppercase">Price (PKR)</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Operator</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ownershipHistory.map(ev => (
                      <tr key={ev.id}>
                        <td className="py-3 text-gray-900 font-medium">
                          {EVENT_TYPE_LABELS[ev.event_type] || ev.event_type}
                        </td>
                        <td className="py-3 text-gray-600">{ev.from_party_name ?? '—'}</td>
                        <td className="py-3 text-gray-900">{ev.to_party_name ?? '—'}</td>
                        <td className="py-3 text-right text-gray-900">{ev.quantity_bags.toLocaleString()}</td>
                        <td className="py-3 text-right text-gray-900">
                          {ev.transfer_price_pkr != null ? ev.transfer_price_pkr.toLocaleString() : '—'}
                        </td>
                        <td className="py-3 text-gray-600">{ev.effective_date}</td>
                        <td className="py-3 text-gray-600">{ev.operator_name ?? '—'}</td>
                        <td className="py-3 text-right">
                          {(ev.event_type === 'TRANSFER_OUT' || ev.event_type === 'TRANSFER_IN') && (
                            <button
                              onClick={() => router.push(`/lots/${id}/transfer/${ev.id}/acknowledgment`)}
                              className="text-xs text-primary-600 hover:underline"
                            >
                              PDF
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'withdrawals' && (
            <div>
              {outboundEvents.length === 0 ? (
                <p className="text-gray-500 text-sm">No withdrawals yet.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Dispatch #</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="pb-2 text-right text-xs font-medium text-gray-500 uppercase">Bags</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="pb-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="pb-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {outboundEvents.map(ev => (
                      <tr key={ev.id}>
                        <td className="py-3 font-mono text-gray-900">{ev.dispatch_note_number ?? '—'}</td>
                        <td className="py-3 text-gray-700">{ev.withdrawal_type}</td>
                        <td className="py-3 text-right text-gray-900">{ev.quantity_withdrawn_bags.toLocaleString()}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                            ev.status === 'DISPATCHED' ? 'bg-green-100 text-green-800' :
                            ev.status === 'WEIGHED' ? 'bg-blue-100 text-blue-800' :
                            ev.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {ev.status}
                          </span>
                        </td>
                        <td className="py-3 text-gray-600">{ev.outbound_date}</td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => router.push(`/outbound-events/${ev.id}`)}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {(activeTab === 'inspections' || activeTab === 'billing') && (
            <p className="text-gray-400 text-sm italic">
              {activeTab === 'inspections' && 'Quality inspections and spoilage records — available in Phase 6.'}
              {activeTab === 'billing' && 'Storage invoices and billing history — available in Phase 5.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
