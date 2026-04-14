'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface ServiceCharge {
  id: string;
  name: string;
  unit_type: string;
  unit_price_pkr: number;
  is_active: boolean;
  created_at: string;
}

interface FormData {
  name: string;
  unit_type: string;
  unit_price_pkr: string;
}

const UNIT_TYPE_LABELS: Record<string, string> = {
  PER_BAG: 'Per Bag',
  PER_TON: 'Per Ton',
  FLAT: 'Flat',
};

const EMPTY_FORM: FormData = { name: '', unit_type: 'PER_BAG', unit_price_pkr: '' };

export default function ServiceChargeListPage() {
  const [charges, setCharges] = useState<ServiceCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchCharges = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient<ServiceCharge[]>('/v1/service-charges');
      setCharges(res);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCharges(); }, [fetchCharges]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError('');
    setShowModal(true);
  };

  const openEdit = (sc: ServiceCharge) => {
    setForm({
      name: sc.name,
      unit_type: sc.unit_type,
      unit_price_pkr: String(sc.unit_price_pkr),
    });
    setEditingId(sc.id);
    setError('');
    setShowModal(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement;
    setForm(prev => ({ ...prev, [target.name]: target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const payload = {
        name: form.name,
        unit_type: form.unit_type,
        unit_price_pkr: parseFloat(form.unit_price_pkr),
      };

      if (editingId) {
        await apiClient(`/v1/service-charges/${editingId}`, { method: 'PATCH', body: payload });
      } else {
        await apiClient('/v1/service-charges', { method: 'POST', body: payload });
      }
      setShowModal(false);
      fetchCharges();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await apiClient(`/v1/service-charges/${id}`, { method: 'DELETE' });
      fetchCharges();
    } catch {
      // handled
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Service Charges</h1>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium"
        >
          New Service Charge
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Unit Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price (PKR)</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">Loading...</td></tr>
            ) : charges.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No service charges found</td></tr>
            ) : (
              charges.map((sc) => (
                <tr key={sc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{sc.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{UNIT_TYPE_LABELS[sc.unit_type] || sc.unit_type}</td>
                  <td className="px-6 py-4 text-sm text-gray-900 font-medium">Rs. {sc.unit_price_pkr.toLocaleString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${sc.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {sc.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(sc)} className="text-primary-600 hover:text-primary-800">Edit</button>
                      {sc.is_active && (
                        <button onClick={() => handleDeactivate(sc.id)} className="text-red-600 hover:text-red-800">Deactivate</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              {editingId ? 'Edit Service Charge' : 'New Service Charge'}
            </h3>
            {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input name="name" value={form.name} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. Loading" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Type *</label>
                <select name="unit_type" value={form.unit_type} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="PER_BAG">Per Bag</option>
                  <option value="PER_TON">Per Ton</option>
                  <option value="FLAT">Flat</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price (PKR) *</label>
                <input name="unit_price_pkr" type="number" step="0.01" min="0" value={form.unit_price_pkr} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
                  {submitting ? 'Saving...' : editingId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
