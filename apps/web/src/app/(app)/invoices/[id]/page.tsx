'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface InvoiceLine {
  id: string;
  line_type: 'STORAGE' | 'SERVICE' | 'ADJUSTMENT' | 'ADVANCE_APPLIED';
  description: string;
  quantity: number;
  unit_price_pkr: number;
  amount_pkr: number;
  service_charge_id: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string | null;
  billing_party_id: string;
  billing_party_name: string;
  lot_id: string;
  lot_number: string;
  invoice_date: string;
  period_start: string;
  period_end: string;
  sub_total_pkr: number;
  gst_rate: number;
  gst_amount_pkr: number;
  total_pkr: number;
  amount_paid_pkr: number;
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
  finalized_at: string | null;
  notes: string | null;
  line_items: InvoiceLine[];
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  FINALIZED: 'bg-green-100 text-green-800',
  VOID: 'bg-gray-100 text-gray-800',
};

const LINE_TYPE_COLORS: Record<string, string> = {
  STORAGE: 'bg-blue-100 text-blue-800',
  SERVICE: 'bg-green-100 text-green-800',
  ADJUSTMENT: 'bg-red-100 text-red-800',
  ADVANCE_APPLIED: 'bg-yellow-100 text-yellow-800',
};

const ROLE_RANK: Record<string, number> = {
  SECURITY: 0, OPERATOR: 1, ACCOUNTANT: 2, MANAGER: 3, OWNER: 4,
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add line modal state
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineType, setLineType] = useState<'SERVICE' | 'ADJUSTMENT'>('SERVICE');
  const [lineDesc, setLineDesc] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('');
  const [lineError, setLineError] = useState('');
  const [lineSubmitting, setLineSubmitting] = useState(false);

  // Finalize state
  const [showFinalize, setShowFinalize] = useState(false);
  const [finalizeNotes, setFinalizeNotes] = useState('');
  const [finalizeSubmitting, setFinalizeSubmitting] = useState(false);
  const [finalizeError, setFinalizeError] = useState('');

  const canManage = user && (ROLE_RANK[user?.role ?? ''] ?? -1) >= 3; // MANAGER

  const fetchInvoice = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<Invoice>(`/v1/invoices/${id}`);
      setInvoice(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchInvoice(); }, [fetchInvoice]);

  async function handleAddLine() {
    if (!lineDesc.trim() || !linePrice) return;
    setLineSubmitting(true);
    setLineError('');
    try {
      await apiClient<Invoice>(`/v1/invoices/${id}/lines`, {
        method: 'POST',
        body: {
          line_type: lineType,
          description: lineDesc,
          quantity: parseFloat(lineQty) || 1,
          unit_price_pkr: parseFloat(linePrice),
        },
      });
      setShowAddLine(false);
      setLineDesc('');
      setLineQty('1');
      setLinePrice('');
      await fetchInvoice();
    } catch (e: any) {
      setLineError(e.message || 'Failed to add line');
    } finally {
      setLineSubmitting(false);
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!confirm('Remove this line item?')) return;
    try {
      await apiClient<Invoice>(`/v1/invoices/${id}/lines/${lineId}`, { method: 'DELETE' });
      await fetchInvoice();
    } catch (e: any) {
      alert(e.message || 'Failed to remove line');
    }
  }

  async function handleFinalize() {
    setFinalizeSubmitting(true);
    setFinalizeError('');
    try {
      await apiClient<Invoice>(`/v1/invoices/${id}/finalize`, {
        method: 'POST',
        body: { notes: finalizeNotes || undefined },
      });
      setShowFinalize(false);
      await fetchInvoice();
    } catch (e: any) {
      setFinalizeError(e.message || 'Failed to finalize invoice');
    } finally {
      setFinalizeSubmitting(false);
    }
  }

  async function handlePdf() {
    const token = localStorage.getItem('access_token');
    const facilityId = localStorage.getItem('facility_id');
    const res = await fetch(`${API_URL}/v1/invoices/${id}/pdf`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
      },
    });
    if (!res.ok) { alert('Failed to load PDF'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center py-16 text-red-500">{error}</div>;
  if (!invoice) return null;

  const isDraft = invoice.status === 'DRAFT';

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button onClick={() => router.back()} className="text-sm text-primary-600 hover:underline mb-2 block">
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            {invoice.invoice_number ?? 'DRAFT Invoice'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 text-sm font-medium rounded-full ${STATUS_COLORS[invoice.status]}`}>
            {invoice.status}
          </span>
          <button
            onClick={handlePdf}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
          >
            Print PDF
          </button>
          {canManage && isDraft && (
            <button
              onClick={() => setShowFinalize(true)}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700"
            >
              Finalize Invoice
            </button>
          )}
          {invoice?.status === 'FINALIZED' && invoice.balance_due_pkr > 0 && (
            <button
              onClick={() => router.push(`/payments/new?party_id=${invoice.billing_party_id}`)}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
            >
              Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Info card */}
      <div className="bg-white rounded-lg shadow p-6 mb-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-gray-500 text-xs uppercase font-medium mb-1">Billing Party</p>
          <p className="font-semibold">{invoice.billing_party_name}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase font-medium mb-1">Lot</p>
          <button
            onClick={() => router.push(`/lots/${invoice.lot_id}`)}
            className="font-mono text-primary-600 hover:underline"
          >
            {invoice.lot_number}
          </button>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase font-medium mb-1">Invoice Date</p>
          <p>{invoice.invoice_date}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase font-medium mb-1">Period Start</p>
          <p>{invoice.period_start}</p>
        </div>
        <div>
          <p className="text-gray-500 text-xs uppercase font-medium mb-1">Period End</p>
          <p>{invoice.period_end}</p>
        </div>
        {invoice.finalized_at && (
          <div>
            <p className="text-gray-500 text-xs uppercase font-medium mb-1">Finalized At</p>
            <p>{new Date(invoice.finalized_at).toLocaleString()}</p>
          </div>
        )}
      </div>

      {/* Line items */}
      <div className="bg-white rounded-lg shadow overflow-hidden mb-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Line Items</h2>
          {canManage && isDraft && (
            <button
              onClick={() => setShowAddLine(true)}
              className="px-3 py-1 bg-primary-600 text-white rounded text-sm hover:bg-primary-700"
            >
              + Add Line
            </button>
          )}
        </div>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount (PKR)</th>
              {canManage && isDraft && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {invoice.line_items.map((line) => (
              <tr key={line.id} className={line.line_type === 'ADJUSTMENT' ? 'text-red-700' : ''}>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${LINE_TYPE_COLORS[line.line_type]}`}>
                    {line.line_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">{line.description}</td>
                <td className="px-4 py-3 text-sm text-right">{line.quantity}</td>
                <td className="px-4 py-3 text-sm text-right">{line.unit_price_pkr.toLocaleString()}</td>
                <td className="px-4 py-3 text-sm text-right font-medium">{line.amount_pkr.toLocaleString()}</td>
                {canManage && isDraft && (
                  <td className="px-4 py-3 text-center">
                    {line.line_type !== 'STORAGE' && line.line_type !== 'ADVANCE_APPLIED' && (
                      <button
                        onClick={() => handleDeleteLine(line.id)}
                        className="text-red-500 hover:text-red-700 text-xs font-medium"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="px-6 py-4 bg-gray-50 border-t">
          <div className="ml-auto w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Subtotal</span>
              <span className="font-medium">PKR {invoice.sub_total_pkr.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">GST ({invoice.gst_rate}%)</span>
              <span>PKR {invoice.gst_amount_pkr.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t pt-1">
              <span>Total</span>
              <span>PKR {invoice.total_pkr.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-green-700">
              <span>Amount Paid</span>
              <span>PKR {invoice.amount_paid_pkr.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-red-700">
              <span>Balance Due</span>
              <span>PKR {invoice.balance_due_pkr.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Add Line Modal */}
      {showAddLine && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4">Add Line Item</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={lineType}
                  onChange={(e) => setLineType((e.target as HTMLSelectElement).value as 'SERVICE' | 'ADJUSTMENT')}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="SERVICE">Service</option>
                  <option value="ADJUSTMENT">Adjustment</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input
                  type="text"
                  value={lineDesc}
                  onChange={(e) => setLineDesc((e.target as HTMLInputElement).value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. Loading charge"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    value={lineQty}
                    onChange={(e) => setLineQty((e.target as HTMLInputElement).value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    min="0.01"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Unit Price (PKR){lineType === 'ADJUSTMENT' ? ' (can be negative)' : ''}
                  </label>
                  <input
                    type="number"
                    value={linePrice}
                    onChange={(e) => setLinePrice((e.target as HTMLInputElement).value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    step="0.01"
                  />
                </div>
              </div>
              {lineError && <p className="text-red-600 text-sm">{lineError}</p>}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setShowAddLine(false); setLineError(''); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button
                onClick={handleAddLine}
                disabled={lineSubmitting || !lineDesc.trim() || !linePrice}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
              >
                {lineSubmitting ? 'Adding…' : 'Add Line'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finalize Modal */}
      {showFinalize && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-2">Finalize Invoice</h2>
            <p className="text-sm text-gray-600 mb-4">
              This will assign an invoice number and lock the invoice for editing.
              Total: <strong>PKR {invoice.total_pkr.toLocaleString()}</strong>
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={finalizeNotes}
                onChange={(e) => setFinalizeNotes((e.target as HTMLTextAreaElement).value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                rows={2}
                placeholder="Any notes for this invoice..."
              />
            </div>
            {finalizeError && <p className="text-red-600 text-sm mt-2">{finalizeError}</p>}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => { setShowFinalize(false); setFinalizeError(''); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button
                onClick={handleFinalize}
                disabled={finalizeSubmitting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {finalizeSubmitting ? 'Finalizing…' : 'Confirm Finalize'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
