'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  invoice_number: string | null;
  allocated_amount_pkr: number;
}

interface Payment {
  id: string;
  facility_id: string;
  party_id: string;
  party_name: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  is_advance: boolean;
  status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' | 'DISHONOURED';
  clearance_status: string;
  cheque_date: string | null;
  book_type: string;
  notes: string | null;
  created_at: string;
  created_by_name: string;
  allocations: PaymentAllocation[];
}

const STATUS_COLORS: Record<string, string> = {
  RECORDED: 'bg-blue-100 text-blue-800',
  ALLOCATED: 'bg-green-100 text-green-800',
  ADVANCE: 'bg-purple-100 text-purple-800',
  DISHONOURED: 'bg-red-100 text-red-800',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_WALLET: 'Mobile Wallet',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function PaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const id = params['id'] as string;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [dishonourNotes, setDishonourNotes] = useState('');
  const [showDishonourForm, setShowDishonourForm] = useState(false);
  const [dishonourSubmitting, setDishonourSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isAccountant = (ROLE_RANK[user?.role ?? ''] ?? -1) >= 2;

  useEffect(() => {
    apiClient<Payment>(`/v1/payments/${id}`)
      .then(setPayment)
      .catch(() => setError('Payment not found'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDishonour = async () => {
    if (!confirm('Dishonour this cheque? All allocations will be reversed.')) return;
    setDishonourSubmitting(true);
    setError('');
    try {
      const updated = await apiClient<Payment>(`/v1/payments/${id}/dishonour`, {
        method: 'POST',
        body: { notes: dishonourNotes || undefined },
      });
      setPayment(updated);
      setShowDishonourForm(false);
    } catch (err: any) {
      setError(err.message || 'Failed to dishonour payment');
    } finally {
      setDishonourSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Loading...</p></div>;
  }

  if (!payment) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">{error || 'Payment not found'}</p>
      </div>
    );
  }

  const totalAllocated = payment.allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
  const unallocated = payment.amount_pkr - totalAllocated;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-2xl font-bold text-gray-900">Payment Detail</h1>
        <span className={`ml-auto px-3 py-1 text-sm font-medium rounded-full ${STATUS_COLORS[payment.status]}`}>
          {payment.status}
        </span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm mb-4">{error}</div>
      )}

      {/* Main Info */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Party</p>
            <p className="text-sm font-medium text-gray-900">
              <button
                onClick={() => router.push(`/parties/${payment.party_id}`)}
                className="text-blue-600 hover:underline"
              >
                {payment.party_name}
              </button>
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Payment Date</p>
            <p className="text-sm text-gray-900">{payment.payment_date}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Method</p>
            <p className="text-sm text-gray-900">{METHOD_LABELS[payment.payment_method] ?? payment.payment_method}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Reference</p>
            <p className="text-sm font-mono text-gray-900">{payment.reference_number ?? '—'}</p>
          </div>
          {payment.cheque_date && (
            <div>
              <p className="text-xs text-gray-500 uppercase mb-1">Cheque Date</p>
              <p className="text-sm text-gray-900">{payment.cheque_date}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Clearance</p>
            <p className="text-sm text-gray-900">{payment.clearance_status}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Book Type</p>
            <p className="text-sm text-gray-900">{payment.book_type}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase mb-1">Recorded By</p>
            <p className="text-sm text-gray-900">{payment.created_by_name}</p>
          </div>
          {payment.notes && (
            <div className="col-span-2">
              <p className="text-xs text-gray-500 uppercase mb-1">Notes</p>
              <p className="text-sm text-gray-700">{payment.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Amount Summary */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase mb-4">Amount Summary</h2>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Payment Amount</span>
          <span className="font-semibold">PKR {payment.amount_pkr.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-600">Allocated</span>
          <span className="text-green-700">PKR {totalAllocated.toLocaleString()}</span>
        </div>
        {unallocated > 0.001 && (
          <div className="flex justify-between text-sm border-t pt-2 mt-2">
            <span className="text-gray-600">Unallocated</span>
            <span className="text-orange-600 font-medium">PKR {unallocated.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Allocations */}
      {payment.allocations.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <h2 className="text-sm font-semibold text-gray-700 uppercase mb-4">Invoice Allocations</h2>
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="py-2 text-left text-xs text-gray-500 uppercase">Invoice</th>
                <th className="py-2 text-right text-xs text-gray-500 uppercase">Allocated (PKR)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payment.allocations.map((alloc) => (
                <tr key={alloc.id}>
                  <td className="py-2 text-sm">
                    <button
                      onClick={() => router.push(`/invoices/${alloc.invoice_id}`)}
                      className="text-blue-600 hover:underline font-mono"
                    >
                      {alloc.invoice_number ?? alloc.invoice_id.slice(0, 8)}
                    </button>
                  </td>
                  <td className="py-2 text-sm text-right font-medium">{alloc.allocated_amount_pkr.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dishonour */}
      {isAccountant && payment.status !== 'DISHONOURED' && payment.payment_method === 'CHEQUE' && (
        <div className="bg-white rounded-lg shadow p-6 mb-4 border-l-4 border-yellow-400">
          <h2 className="text-sm font-semibold text-gray-700 uppercase mb-3">Cheque Dishonour</h2>
          {!showDishonourForm ? (
            <button
              onClick={() => setShowDishonourForm(true)}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700"
            >
              Mark Cheque as Dishonoured
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-600">All allocations will be reversed and invoice balances restored.</p>
              <textarea
                value={dishonourNotes}
                onChange={(e) => setDishonourNotes((e.target as HTMLTextAreaElement).value)}
                rows={2}
                placeholder="Reason for dishonour (optional)"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleDishonour}
                  disabled={dishonourSubmitting}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {dishonourSubmitting ? 'Processing...' : 'Confirm Dishonour'}
                </button>
                <button
                  onClick={() => setShowDishonourForm(false)}
                  className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
