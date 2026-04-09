'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface PartyFormData {
  name: string;
  name_urdu: string;
  party_type: string;
  phone_primary: string;
  phone_secondary: string;
  address: string;
  cnic: string;
  parent_arhti_id: string;
  credit_limit_pkr: string;
  credit_terms_days: string;
  notes: string;
}

interface Arhti {
  id: string;
  name: string;
}

interface PartyFormProps {
  initialData?: Partial<PartyFormData>;
  partyId?: string;
  mode: 'create' | 'edit';
}

const EMPTY_FORM: PartyFormData = {
  name: '',
  name_urdu: '',
  party_type: 'FARMER',
  phone_primary: '',
  phone_secondary: '',
  address: '',
  cnic: '',
  parent_arhti_id: '',
  credit_limit_pkr: '',
  credit_terms_days: '30',
  notes: '',
};

export function PartyForm({ initialData, partyId, mode }: PartyFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<PartyFormData>({ ...EMPTY_FORM, ...initialData });
  const [arhtis, setArhtis] = useState<Arhti[]>([]);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiClient<Arhti[]>('/v1/parties?type=ARHTI&is_active=true&per_page=100')
      .then(setArhtis)
      .catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    setForm(prev => ({ ...prev, [target.name]: target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarnings([]);
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        party_type: form.party_type,
        phone_primary: form.phone_primary,
        credit_terms_days: parseInt(form.credit_terms_days) || 30,
      };
      if (form.name_urdu) payload['name_urdu'] = form.name_urdu;
      if (form.phone_secondary) payload['phone_secondary'] = form.phone_secondary;
      if (form.address) payload['address'] = form.address;
      if (form.cnic) payload['cnic'] = form.cnic;
      if (form.parent_arhti_id) payload['parent_arhti_id'] = form.parent_arhti_id;
      if (form.credit_limit_pkr) payload['credit_limit_pkr'] = parseFloat(form.credit_limit_pkr);
      if (form.notes) payload['notes'] = form.notes;

      if (mode === 'create') {
        const result = await apiClient<{ id: string; warnings?: string[] }>('/v1/parties', {
          method: 'POST',
          body: payload,
        });
        if (result.warnings) setWarnings(result.warnings);
        router.push(`/parties/${result.id}`);
      } else {
        await apiClient(`/v1/parties/${partyId}`, {
          method: 'PATCH',
          body: payload,
        });
        router.push(`/parties/${partyId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save party');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 max-w-2xl">
      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
      {warnings.length > 0 && (
        <div className="mb-4 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
          <input name="name" value={form.name} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name (Urdu)</label>
          <input name="name_urdu" value={form.name_urdu} onChange={handleChange} dir="rtl" className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Party Type *</label>
          <select name="party_type" value={form.party_type} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="FARMER">Farmer</option>
            <option value="TRADER">Trader</option>
            <option value="ARHTI">Arhti</option>
            <option value="BUYER">Buyer</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Primary Phone *</label>
          <input name="phone_primary" value={form.phone_primary} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Phone</label>
          <input name="phone_secondary" value={form.phone_secondary} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CNIC</label>
          <input name="cnic" value={form.cnic} onChange={handleChange} maxLength={15} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Parent Arhti</label>
          <select name="parent_arhti_id" value={form.parent_arhti_id} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
            <option value="">None</option>
            {arhtis.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Credit Limit (PKR)</label>
          <input name="credit_limit_pkr" type="number" value={form.credit_limit_pkr} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Credit Terms (Days)</label>
          <input name="credit_terms_days" type="number" value={form.credit_terms_days} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
          <input name="address" value={form.address} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} className="w-full border rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
          {submitting ? 'Saving...' : mode === 'create' ? 'Create Party' : 'Save Changes'}
        </button>
        <button type="button" onClick={() => router.back()} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}
