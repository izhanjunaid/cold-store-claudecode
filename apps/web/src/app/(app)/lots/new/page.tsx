'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface Party { id: string; name: string; }
interface Commodity { id: string; name: string; }
interface Variety { id: string; name: string; commodity_id: string; }
interface Chamber {
  id: string; name: string;
  commodity_restriction_id: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  available_capacity_bags: number;
}
interface RatePlan {
  id: string; name: string;
  commodity_id: string | null;
  rate_type: string;
  rate_amount_pkr: number;
}

interface FormData {
  owner_party_id: string;
  billing_party_id: string;
  billing_override: boolean;
  commodity_id: string;
  variety_id: string;
  chamber_id: string;
  rate_plan_id: string;
  quantity_bags: string;
  declared_weight_kg: string;
  accepted_weight_kg: string;
  weight_dispute_note: string;
  vehicle_number: string;
  quality_grade_inbound: string;
  inbound_date: string;
  book_type: string;
  notes: string;
}

const EMPTY: FormData = {
  owner_party_id: '', billing_party_id: '', billing_override: false,
  commodity_id: '', variety_id: '', chamber_id: '', rate_plan_id: '',
  quantity_bags: '', declared_weight_kg: '', accepted_weight_kg: '',
  weight_dispute_note: '', vehicle_number: '', quality_grade_inbound: '',
  inbound_date: new Date().toISOString().slice(0, 10), book_type: 'PACCI', notes: '',
};

export default function LotCreatePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY);
  const [parties, setParties] = useState<Party[]>([]);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [chambers, setChambers] = useState<Chamber[]>([]);
  const [ratePlans, setRatePlans] = useState<RatePlan[]>([]);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Load reference data
  useEffect(() => {
    apiClient<Party[]>('/v1/parties?is_active=true&per_page=500').then(setParties).catch(() => {});
    apiClient<Commodity[]>('/v1/commodities').then(setCommodities).catch(() => {});
    apiClient<Variety[]>('/v1/varieties').then(setVarieties).catch(() => {});
    apiClient<Chamber[]>('/v1/chambers?is_active=true').then(setChambers).catch(() => {});
    apiClient<RatePlan[]>('/v1/rate-plans?is_active=true').then(setRatePlans).catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    setForm(prev => ({ ...prev, [target.name]: target.value }));
  };

  // Computed: weight dispute detection
  const declared = parseFloat(form.declared_weight_kg) || 0;
  const accepted = parseFloat(form.accepted_weight_kg) || 0;
  const variancePct = declared > 0 ? Math.abs(accepted - declared) / declared * 100 : 0;
  const hasDispute = declared > 0 && variancePct > 2;

  // Computed: filter chambers by commodity restriction
  const filteredChambers = form.commodity_id
    ? chambers.filter(c => !c.commodity_restriction_id || c.commodity_restriction_id === form.commodity_id)
    : chambers;

  // Computed: filter rate plans by commodity
  const filteredPlans = form.commodity_id
    ? ratePlans.filter(p => !p.commodity_id || p.commodity_id === form.commodity_id)
    : ratePlans;

  // Computed: filter varieties by commodity
  const filteredVarieties = form.commodity_id
    ? varieties.filter(v => v.commodity_id === form.commodity_id)
    : varieties;

  // Computed: chamber capacity warning
  const selectedChamber = chambers.find(c => c.id === form.chamber_id);
  const qty = parseInt(form.quantity_bags) || 0;
  const capacityPct = selectedChamber
    ? ((selectedChamber.current_occupancy_bags + qty) / selectedChamber.max_capacity_bags) * 100
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setWarnings([]);
    setSubmitting(true);

    try {
      const payload: Record<string, unknown> = {
        owner_party_id: form.owner_party_id,
        commodity_id: form.commodity_id,
        chamber_id: form.chamber_id,
        rate_plan_id: form.rate_plan_id,
        quantity_bags: parseInt(form.quantity_bags),
        accepted_weight_kg: parseFloat(form.accepted_weight_kg),
      };
      if (form.billing_override && form.billing_party_id) payload['billing_party_id'] = form.billing_party_id;
      if (form.variety_id) payload['variety_id'] = form.variety_id;
      if (form.declared_weight_kg) payload['declared_weight_kg'] = parseFloat(form.declared_weight_kg);
      if (hasDispute && form.weight_dispute_note) payload['weight_dispute_note'] = form.weight_dispute_note;
      if (form.vehicle_number) payload['vehicle_number'] = form.vehicle_number;
      if (form.quality_grade_inbound) payload['quality_grade_inbound'] = form.quality_grade_inbound;
      if (form.inbound_date) payload['inbound_date'] = form.inbound_date;
      if (form.book_type) payload['book_type'] = form.book_type;
      if (form.notes) payload['notes'] = form.notes;

      const result = await apiClient<{ id: string; lot_number: string; warnings?: string[] }>('/v1/lots', {
        method: 'POST',
        body: payload,
      });
      if (result.warnings) setWarnings(result.warnings);
      router.push(`/lots/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create lot');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">New Inbound Lot</h1>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 max-w-3xl">
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        {warnings.length > 0 && (
          <div className="mb-4 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
            {warnings.map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}

        {/* Weight dispute banner */}
        {hasDispute && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm font-medium text-yellow-800">
              Weight Dispute Detected: {variancePct.toFixed(1)}% variance between declared and accepted weight.
            </p>
            <p className="text-xs text-yellow-600 mt-1">A dispute note is required to proceed.</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Owner Party */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner Party *</label>
            <select name="owner_party_id" value={form.owner_party_id} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select party...</option>
              {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Billing party override */}
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mb-1">
              <input
                type="checkbox"
                checked={form.billing_override}
                onChange={(e) => setForm(prev => ({ ...prev, billing_override: (e.target as HTMLInputElement).checked }))}
                className="rounded border-gray-300"
              />
              Different billing party
            </label>
            {form.billing_override && (
              <select name="billing_party_id" value={form.billing_party_id} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm mt-1">
                <option value="">Select billing party...</option>
                {parties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>

          {/* Commodity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Commodity *</label>
            <select
              name="commodity_id"
              value={form.commodity_id}
              onChange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                setForm(prev => ({ ...prev, commodity_id: val, variety_id: '', chamber_id: '', rate_plan_id: '' }));
              }}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select commodity...</option>
              {commodities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Variety */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Variety</label>
            <select name="variety_id" value={form.variety_id} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">None</option>
              {filteredVarieties.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>

          {/* Chamber */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chamber *</label>
            <select name="chamber_id" value={form.chamber_id} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select chamber...</option>
              {filteredChambers.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.available_capacity_bags.toLocaleString()} avail / {c.max_capacity_bags.toLocaleString()})
                </option>
              ))}
            </select>
            {selectedChamber && capacityPct > 90 && (
              <p className="text-xs text-red-600 mt-1">Chamber will be {capacityPct.toFixed(0)}% full after this inbound.</p>
            )}
          </div>

          {/* Rate Plan */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rate Plan *</label>
            <select name="rate_plan_id" value={form.rate_plan_id} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select rate plan...</option>
              {filteredPlans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} (Rs. {p.rate_amount_pkr})
                </option>
              ))}
            </select>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (Bags) *</label>
            <input name="quantity_bags" type="number" min="1" value={form.quantity_bags} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Declared Weight */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Declared Weight (kg)</label>
            <input name="declared_weight_kg" type="number" step="0.01" min="0" value={form.declared_weight_kg} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Accepted Weight */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Accepted Weight (kg) *</label>
            <input name="accepted_weight_kg" type="number" step="0.01" min="0.01" value={form.accepted_weight_kg} onChange={handleChange} required className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Vehicle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Number</label>
            <input name="vehicle_number" value={form.vehicle_number} onChange={handleChange} maxLength={20} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. LEA-1234" />
          </div>

          {/* Quality Grade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quality Grade</label>
            <select name="quality_grade_inbound" value={form.quality_grade_inbound} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Not graded</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </div>

          {/* Inbound Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Inbound Date</label>
            <input name="inbound_date" type="date" value={form.inbound_date} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>

          {/* Book Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Book Type</label>
            <select name="book_type" value={form.book_type} onChange={handleChange} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="PACCI">Pacci (Official)</option>
              <option value="KATCHI">Katchi (Informal)</option>
            </select>
          </div>

          {/* Weight dispute note (conditional) */}
          {hasDispute && (
            <div className="col-span-2">
              <label className="block text-sm font-medium text-yellow-700 mb-1">Dispute Note *</label>
              <textarea
                name="weight_dispute_note"
                value={form.weight_dispute_note}
                onChange={handleChange}
                required
                rows={2}
                className="w-full border border-yellow-300 rounded-lg px-3 py-2 text-sm bg-yellow-50"
                placeholder="Explain the weight variance..."
              />
            </div>
          )}

          {/* Notes */}
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button type="submit" disabled={submitting} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
            {submitting ? 'Creating...' : 'Create Inbound Lot'}
          </button>
          <button type="button" onClick={() => router.back()} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
