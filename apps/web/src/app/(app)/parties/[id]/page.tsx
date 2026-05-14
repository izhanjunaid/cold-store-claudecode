'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiClient, apiClientList } from '@/lib/api-client';

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

interface LotSummary {
  id: string;
  lot_number: string;
  commodity_name: string | null;
  current_balance_bags: number;
  status: string;
  inbound_date: string;
}

interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  lot_number: string;
  invoice_date: string;
  total_pkr: number;
  balance_due_pkr: number;
  status: string;
}

interface PaymentSummary {
  id: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  status: string;
  allocations: { id: string }[];
}

interface LedgerEntry {
  date: string;
  type: 'INVOICE' | 'PAYMENT';
  reference: string | null;
  description: string;
  debit_pkr: number;
  credit_pkr: number;
  balance_pkr: number;
  id: string;
}

interface LedgerData {
  party_id: string;
  party_name: string;
  entries: LedgerEntry[];
  total_debit_pkr: number;
  total_credit_pkr: number;
  closing_balance_pkr: number;
}

interface LoanSummary {
  id: string;
  loan_number: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
}

const LOAN_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  RECOVERED: 'bg-gray-100 text-gray-700',
  WRITTEN_OFF: 'bg-red-100 text-red-700',
};

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
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [tabLoaded, setTabLoaded] = useState<Record<string, boolean>>({});

  const partyId = params['id'] as string;

  useEffect(() => {
    apiClient<Party>(`/v1/parties/${partyId}`)
      .then(setParty)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partyId]);

  const loadTab = useCallback(async (tab: string) => {
    if (tabLoaded[tab]) return;
    setTabLoaded((prev) => ({ ...prev, [tab]: true }));
    try {
      if (tab === 'Active Lots') {
        const res = await apiClientList<LotSummary>(`/v1/lots?owner_party_id=${partyId}&status=ACTIVE&page_size=100`);
        setLots(res.data);
      } else if (tab === 'Invoices') {
        const res = await apiClientList<InvoiceSummary>(`/v1/invoices?party_id=${partyId}&page_size=100`);
        setInvoices(res.data);
      } else if (tab === 'Payments') {
        const res = await apiClientList<PaymentSummary>(`/v1/payments?party_id=${partyId}&page_size=100`);
        setPayments(res.data);
      } else if (tab === 'Ledger') {
        const data = await apiClient<LedgerData>(`/v1/parties/${partyId}/ledger`);
        setLedger(data);
      } else if (tab === 'Peshgi') {
        const res = await apiClientList<LoanSummary>(`/v1/loans?party_id=${partyId}&page_size=100`);
        setLoans(res.data);
      }
    } catch {
      // silently handled
    }
  }, [partyId, tabLoaded]);

  useEffect(() => { loadTab('Active Lots'); }, [partyId]); // eslint-disable-line react-hooks/exhaustive-deps

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
                onClick={() => { setActiveTab(tab); loadTab(tab); }}
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

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'Active Lots' && (
            lots.length === 0 ? (
              <p className="text-sm text-gray-400">No active lots for this party.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead><tr>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Lot #</th>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Commodity</th>
                  <th className="pb-2 text-right text-xs text-gray-500 uppercase">Balance (Bags)</th>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Inbound Date</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {lots.map((lot) => (
                    <tr key={lot.id} onClick={() => router.push(`/lots/${lot.id}`)} className="cursor-pointer hover:bg-gray-50">
                      <td className="py-2 text-sm font-mono text-blue-600">{lot.lot_number}</td>
                      <td className="py-2 text-sm text-gray-700">{lot.commodity_name ?? '—'}</td>
                      <td className="py-2 text-sm text-right font-medium">{lot.current_balance_bags}</td>
                      <td className="py-2 text-sm text-gray-600">{lot.inbound_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {activeTab === 'Invoices' && (
            invoices.length === 0 ? (
              <p className="text-sm text-gray-400">No invoices for this party.</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead><tr>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Invoice #</th>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Lot</th>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Date</th>
                  <th className="pb-2 text-right text-xs text-gray-500 uppercase">Total (PKR)</th>
                  <th className="pb-2 text-right text-xs text-gray-500 uppercase">Balance (PKR)</th>
                  <th className="pb-2 text-left text-xs text-gray-500 uppercase">Status</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {invoices.map((inv) => (
                    <tr key={inv.id} onClick={() => router.push(`/invoices/${inv.id}`)} className="cursor-pointer hover:bg-gray-50">
                      <td className="py-2 text-sm font-mono text-blue-600">{inv.invoice_number ?? <span className="italic text-gray-400">Draft</span>}</td>
                      <td className="py-2 text-sm font-mono text-gray-600">{inv.lot_number}</td>
                      <td className="py-2 text-sm text-gray-600">{inv.invoice_date}</td>
                      <td className="py-2 text-sm text-right">{inv.total_pkr.toLocaleString()}</td>
                      <td className="py-2 text-sm text-right font-medium text-red-700">{inv.balance_due_pkr.toLocaleString()}</td>
                      <td className="py-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full ${inv.status === 'FINALIZED' ? 'bg-green-100 text-green-800' : inv.status === 'DRAFT' ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>{inv.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {activeTab === 'Payments' && (
            <div>
              <div className="flex justify-end mb-4">
                <button
                  onClick={() => router.push(`/payments/new?party_id=${partyId}`)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                >
                  Record Payment
                </button>
              </div>
              {payments.length === 0 ? (
                <p className="text-sm text-gray-400">No payments recorded for this party.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead><tr>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Date</th>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Method</th>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Reference</th>
                    <th className="pb-2 text-right text-xs text-gray-500 uppercase">Amount (PKR)</th>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Status</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {payments.map((pay) => (
                      <tr key={pay.id} onClick={() => router.push(`/payments/${pay.id}`)} className="cursor-pointer hover:bg-gray-50">
                        <td className="py-2 text-sm text-gray-600">{pay.payment_date}</td>
                        <td className="py-2 text-sm text-gray-700">{pay.payment_method}</td>
                        <td className="py-2 text-sm font-mono text-gray-600">{pay.reference_number ?? '—'}</td>
                        <td className="py-2 text-sm text-right font-medium">{pay.amount_pkr.toLocaleString()}</td>
                        <td className="py-2 text-xs">
                          <span className={`px-2 py-0.5 rounded-full ${pay.status === 'ALLOCATED' ? 'bg-green-100 text-green-800' : pay.status === 'DISHONOURED' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}`}>{pay.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {activeTab === 'Ledger' && (
            !ledger ? (
              <p className="text-sm text-gray-400">Loading ledger...</p>
            ) : ledger.entries.length === 0 ? (
              <p className="text-sm text-gray-400">No ledger entries for this party.</p>
            ) : (
              <div>
                <table className="min-w-full divide-y divide-gray-200 mb-4">
                  <thead><tr>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Date</th>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Type</th>
                    <th className="pb-2 text-left text-xs text-gray-500 uppercase">Description</th>
                    <th className="pb-2 text-right text-xs text-gray-500 uppercase">Debit (PKR)</th>
                    <th className="pb-2 text-right text-xs text-gray-500 uppercase">Credit (PKR)</th>
                    <th className="pb-2 text-right text-xs text-gray-500 uppercase">Balance (PKR)</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {ledger.entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="py-2 text-sm text-gray-600">{entry.date}</td>
                        <td className="py-2 text-xs">
                          <span className={`px-2 py-0.5 rounded-full ${entry.type === 'INVOICE' ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>{entry.type}</span>
                        </td>
                        <td className="py-2 text-sm text-gray-700">{entry.description}</td>
                        <td className="py-2 text-sm text-right text-red-700">{entry.debit_pkr > 0 ? entry.debit_pkr.toLocaleString() : '—'}</td>
                        <td className="py-2 text-sm text-right text-green-700">{entry.credit_pkr > 0 ? entry.credit_pkr.toLocaleString() : '—'}</td>
                        <td className="py-2 text-sm text-right font-medium">{entry.balance_pkr.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t pt-4 flex justify-between text-sm">
                  <span className="text-gray-600">Total Invoiced: <strong>PKR {ledger.total_debit_pkr.toLocaleString()}</strong></span>
                  <span className="text-gray-600">Total Paid: <strong>PKR {ledger.total_credit_pkr.toLocaleString()}</strong></span>
                  <span className={`font-semibold ${ledger.closing_balance_pkr > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    Outstanding: PKR {ledger.closing_balance_pkr.toLocaleString()}
                  </span>
                </div>
              </div>
            )
          )}

          {activeTab === 'Peshgi' && (
            <div>
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm text-gray-600">
                  {loans.length === 0
                    ? 'No peshgi loans yet.'
                    : `${loans.filter((l) => l.status === 'ACTIVE').length} active · ${loans.length} total`}
                </p>
                <Link
                  href={`/loans/issue?party_id=${partyId}`}
                  className="bg-emerald-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-emerald-700"
                >
                  Issue Peshgi
                </Link>
              </div>
              {loans.length > 0 && (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Loan No.</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Issued</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Principal</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Balance</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {loans.map((l) => (
                      <tr
                        key={l.id}
                        onClick={() => router.push(`/loans/${l.id}`)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-2 text-sm font-mono text-gray-900">{l.loan_number}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{l.issue_date}</td>
                        <td className="px-4 py-2 text-sm text-right">{Number(l.principal_pkr).toLocaleString()}</td>
                        <td className="px-4 py-2 text-sm text-right font-medium">{Number(l.balance_outstanding_pkr).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${LOAN_STATUS_COLORS[l.status]}`}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
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
