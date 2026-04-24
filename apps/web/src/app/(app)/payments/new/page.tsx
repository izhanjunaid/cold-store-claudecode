'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, apiClientList } from '@/lib/api-client';

interface Party {
  id: string;
  name: string;
  is_active: boolean;
}

interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  total_pkr: number;
  amount_paid_pkr: number;
  balance_due_pkr: number;
  invoice_date: string;
  status: string;
}

interface AllocationRow {
  invoice_id: string;
  allocated_amount_pkr: string;
}

export default function NewPaymentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedPartyId = searchParams.get('party_id') ?? '';

  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [partyId, setPartyId] = useState(preselectedPartyId);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amountPkr, setAmountPkr] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [chequeDate, setChequeDate] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);

  useEffect(() => {
    apiClientList<Party>('/v1/parties?page_size=200&is_active=true')
      .then((res) => setParties(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchInvoices = useCallback(async (pid: string) => {
    if (!pid) { setInvoices([]); return; }
    try {
      const res = await apiClientList<InvoiceSummary>(`/v1/invoices?party_id=${pid}&status=FINALIZED&page_size=100`);
      setInvoices(res.data.filter((i) => i.balance_due_pkr > 0));
    } catch {
      setInvoices([]);
    }
  }, []);

  useEffect(() => { fetchInvoices(partyId); }, [partyId, fetchInvoices]);

  const totalAllocated = allocations.reduce((s, a) => s + (parseFloat(a.allocated_amount_pkr) || 0), 0);

  const addAllocation = () => {
    setAllocations((prev) => [...prev, { invoice_id: '', allocated_amount_pkr: '' }]);
  };

  const removeAllocation = (idx: number) => {
    setAllocations((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateAllocation = (idx: number, field: keyof AllocationRow, value: string) => {
    setAllocations((prev) => prev.map((a, i) => i === idx ? { ...a, [field]: value } : a));
  };

  const fillBalance = (idx: number) => {
    const alloc = allocations[idx];
    if (!alloc) return;
    const inv = invoices.find((i) => i.id === alloc.invoice_id);
    if (!inv) return;
    updateAllocation(idx, 'allocated_amount_pkr', String(inv.balance_due_pkr));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partyId) { setError('Please select a party.'); return; }
    if (!amountPkr || parseFloat(amountPkr) <= 0) { setError('Amount must be positive.'); return; }

    const validAllocations = isAdvance ? [] : allocations
      .filter((a) => a.invoice_id && parseFloat(a.allocated_amount_pkr) > 0)
      .map((a) => ({ invoice_id: a.invoice_id, allocated_amount_pkr: parseFloat(a.allocated_amount_pkr) }));

    setSubmitting(true);
    setError('');
    try {
      const result = await apiClient<{ id: string }>('/v1/payments', {
        method: 'POST',
        body: {
          party_id: partyId,
          payment_date: paymentDate,
          amount_pkr: parseFloat(amountPkr),
          payment_method: paymentMethod,
          reference_number: referenceNumber || undefined,
          is_advance: isAdvance,
          cheque_date: (paymentMethod === 'CHEQUE' && chequeDate) ? chequeDate : undefined,
          notes: notes || undefined,
          allocations: validAllocations,
        },
      });
      router.push(`/payments/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to record payment');
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><p className="text-gray-500">Loading...</p></div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-2xl font-bold text-gray-900">Record Payment</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Payment Details</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Party *</label>
            <select
              value={partyId}
              onChange={(e) => { setPartyId((e.target as HTMLSelectElement).value); setAllocations([]); }}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select party...</option>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date *</label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate((e.target as HTMLInputElement).value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKR) *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amountPkr}
                onChange={(e) => setAmountPkr((e.target as HTMLInputElement).value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method *</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod((e.target as HTMLSelectElement).value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="MOBILE_WALLET">Mobile Wallet</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number</label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber((e.target as HTMLInputElement).value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Cheque #, transfer ref..."
              />
            </div>
          </div>

          {paymentMethod === 'CHEQUE' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cheque Date</label>
              <input
                type="date"
                value={chequeDate}
                onChange={(e) => setChequeDate((e.target as HTMLInputElement).value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="is_advance"
              checked={isAdvance}
              onChange={(e) => { setIsAdvance((e.target as HTMLInputElement).checked); setAllocations([]); }}
              className="rounded"
            />
            <label htmlFor="is_advance" className="text-sm font-medium text-gray-700">
              Advance payment (no invoice allocation)
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
              rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!isAdvance && (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Invoice Allocations</h2>
              <button
                type="button"
                onClick={addAllocation}
                disabled={!partyId || invoices.length === 0}
                className="text-blue-600 text-sm hover:underline disabled:opacity-40"
              >
                + Add Invoice
              </button>
            </div>

            {partyId && invoices.length === 0 && (
              <p className="text-sm text-gray-500 italic">No finalized invoices with outstanding balance for this party.</p>
            )}

            {allocations.map((alloc, idx) => (
              <div key={idx} className="flex gap-3 items-end mb-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Invoice</label>
                  <select
                    value={alloc.invoice_id}
                    onChange={(e) => updateAllocation(idx, 'invoice_id', (e.target as HTMLSelectElement).value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select invoice...</option>
                    {invoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoice_number ?? 'Draft'} — Balance: PKR {inv.balance_due_pkr.toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-40">
                  <label className="block text-xs text-gray-500 mb-1">Amount (PKR)</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={alloc.allocated_amount_pkr}
                    onChange={(e) => updateAllocation(idx, 'allocated_amount_pkr', (e.target as HTMLInputElement).value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="0.00"
                  />
                </div>
                {alloc.invoice_id && (
                  <button
                    type="button"
                    onClick={() => fillBalance(idx)}
                    className="text-xs text-blue-600 hover:underline whitespace-nowrap pb-2"
                  >
                    Fill balance
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeAllocation(idx)}
                  className="text-red-500 hover:text-red-700 pb-2"
                >
                  ×
                </button>
              </div>
            ))}

            {allocations.length > 0 && (
              <div className="text-sm text-right text-gray-600 mt-2">
                Total allocated: <span className="font-medium">PKR {totalAllocated.toLocaleString()}</span>
                {amountPkr && (
                  <span className={`ml-2 ${totalAllocated > parseFloat(amountPkr) ? 'text-red-600' : 'text-green-600'}`}>
                    / PKR {parseFloat(amountPkr).toLocaleString()}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-4 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Recording...' : 'Record Payment'}
          </button>
        </div>
      </form>
    </div>
  );
}
