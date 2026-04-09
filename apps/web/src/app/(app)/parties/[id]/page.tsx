'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';

interface Party {
  id: string;
  name: string;
  name_urdu: string | null;
  party_type: string;
  phone_primary: string;
  phone_secondary: string | null;
  address: string | null;
  cnic: string | null;
  parent_arhti_id: string | null;
  parent_arhti_name: string | null;
  credit_limit_pkr: number | null;
  credit_terms_days: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

const PARTY_TYPE_COLORS: Record<string, string> = {
  FARMER: 'bg-green-100 text-green-800',
  TRADER: 'bg-blue-100 text-blue-800',
  ARHTI: 'bg-purple-100 text-purple-800',
  BUYER: 'bg-orange-100 text-orange-800',
  OTHER: 'bg-gray-100 text-gray-800',
};

const TABS = ['Active Lots', 'Invoices', 'Payments', 'Ledger', 'Peshgi'] as const;

export default function PartyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('Active Lots');
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);

  useEffect(() => {
    apiClient<Party>(`/v1/parties/${params['id']}`)
      .then(setParty)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params['id']]);

  const handleDeactivate = async () => {
    try {
      await apiClient(`/v1/parties/${params['id']}`, { method: 'DELETE' });
      setParty(prev => prev ? { ...prev, is_active: false } : null);
      setShowDeactivateModal(false);
    } catch {
      // handled by apiClient
    }
  };

  if (loading) return <div className="text-gray-500 p-6">Loading...</div>;
  if (!party) return <div className="text-red-500 p-6">Party not found</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{party.name}</h1>
          {party.name_urdu && <p className="text-lg text-gray-500" dir="rtl">{party.name_urdu}</p>}
        </div>
        <div className="flex gap-2">
          <Link
            href={`/parties/${party.id}/edit`}
            className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            Edit
          </Link>
          {party.is_active && (
            <button
              onClick={() => setShowDeactivateModal(true)}
              className="px-4 py-2 border border-red-200 rounded-lg text-sm text-red-600 hover:bg-red-50"
            >
              Deactivate
            </button>
          )}
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Party Info */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-4">Party Information</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Type</dt>
              <dd>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${PARTY_TYPE_COLORS[party.party_type] || ''}`}>
                  {party.party_type}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${party.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {party.is_active ? 'Active' : 'Inactive'}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Phone</dt>
              <dd className="text-sm text-gray-900">{party.phone_primary}</dd>
            </div>
            {party.phone_secondary && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Phone (Alt)</dt>
                <dd className="text-sm text-gray-900">{party.phone_secondary}</dd>
              </div>
            )}
            {party.cnic && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">CNIC</dt>
                <dd className="text-sm text-gray-900">{party.cnic}</dd>
              </div>
            )}
            {party.address && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Address</dt>
                <dd className="text-sm text-gray-900 text-right max-w-[60%]">{party.address}</dd>
              </div>
            )}
            {party.parent_arhti_name && (
              <div className="flex justify-between">
                <dt className="text-sm text-gray-500">Linked Arhti</dt>
                <dd className="text-sm text-gray-900">{party.parent_arhti_name}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Created</dt>
              <dd className="text-sm text-gray-900">{new Date(party.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>

        {/* Credit Profile */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-4">Credit Profile</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Credit Limit</dt>
              <dd className="text-sm text-gray-900 font-medium">
                {party.credit_limit_pkr ? `PKR ${party.credit_limit_pkr.toLocaleString()}` : 'No limit set'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Credit Terms</dt>
              <dd className="text-sm text-gray-900">{party.credit_terms_days} days</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Current Balance</dt>
              <dd className="text-sm text-gray-400">PKR 0 (computed in later phases)</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b">
          <nav className="flex -mb-px">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-sm font-medium border-b-2 ${
                  activeTab === tab
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-6 text-sm text-gray-400">
          {activeTab} will be populated in later phases.
        </div>
      </div>

      {/* Deactivate Modal */}
      {showDeactivateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Deactivate Party</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to deactivate <strong>{party.name}</strong>? This will prevent new transactions with this party.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeactivateModal(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={handleDeactivate} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">Deactivate</button>
            </div>
          </div>
        </div>
      )}

      {party.notes && (
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-sm font-medium text-gray-500 uppercase mb-2">Notes</h2>
          <p className="text-sm text-gray-700">{party.notes}</p>
        </div>
      )}
    </div>
  );
}
