'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { FacilityResponseType } from '@coldchain/shared';

interface Commodity {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const [facility, setFacility] = useState<FacilityResponseType | null>(null);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [weightThreshold, setWeightThreshold] = useState('5');
  const [gstRegistered, setGstRegistered] = useState(false);
  const [numberFormat, setNumberFormat] = useState<'en-PK' | 'en-IN'>('en-PK');
  const [alertThresholds, setAlertThresholds] = useState<Record<string, number>>({});
  const [chamberWarningPct, setChamberWarningPct] = useState('90');
  const [backdatingMaxDays, setBackdatingMaxDays] = useState(''); // '' = unlimited
  const [gstDefaultRate, setGstDefaultRate] = useState('18');
  const [surchargeEnabled, setSurchargeEnabled] = useState(false);
  const [surchargePctPerMonth, setSurchargePctPerMonth] = useState('2');
  const [surchargeGraceDays, setSurchargeGraceDays] = useState('30');

  useEffect(() => {
    Promise.all([
      apiClient<FacilityResponseType>('/v1/facilities/me'),
      apiClient<Commodity[]>('/v1/commodities'),
    ])
      .then(([f, c]) => {
        setFacility(f);
        setCommodities(c);
        setName(f.name);
        setAddress(f.address ?? '');
        setCity(f.city);
        setPhone(f.phone ?? '');
        setGstNumber(f.gst_number ?? '');
        setWeightThreshold(String(f.settings.weight_dispute_threshold_kg));
        setGstRegistered(f.settings.gst_registered);
        setNumberFormat(f.settings.number_format);
        setAlertThresholds(f.settings.storage_alert_thresholds ?? {});
        setChamberWarningPct(String(f.settings.chamber_capacity_warning_pct ?? 90));
        setBackdatingMaxDays(
          f.settings.backdating_max_days == null ? '' : String(f.settings.backdating_max_days),
        );
        setGstDefaultRate(String(f.settings.gst_default_rate ?? 18));
        setSurchargeEnabled(f.settings.late_payment_surcharge?.enabled ?? false);
        setSurchargePctPerMonth(String(f.settings.late_payment_surcharge?.pct_per_month ?? 2));
        setSurchargeGraceDays(String(f.settings.late_payment_surcharge?.grace_days ?? 30));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setError(null);
    setSavedAt(null);
    setSaving(true);
    try {
      const cleanedThresholds: Record<string, number> = {};
      for (const [k, v] of Object.entries(alertThresholds)) {
        if (typeof v === 'number' && v > 0) cleanedThresholds[k] = Math.floor(v);
      }
      const updated = await apiClient<FacilityResponseType>('/v1/facilities/me', {
        method: 'PATCH',
        body: {
          name,
          address: address.trim() || null,
          city,
          phone: phone.trim() || null,
          gst_number: gstNumber.trim() || null,
          settings: {
            weight_dispute_threshold_kg: Number(weightThreshold) || 0,
            storage_alert_thresholds: cleanedThresholds,
            gst_registered: gstRegistered,
            number_format: numberFormat,
            chamber_capacity_warning_pct: Math.min(100, Math.max(1, Math.floor(Number(chamberWarningPct) || 90))),
            backdating_max_days:
              backdatingMaxDays.trim() === '' ? null : Math.max(0, Math.floor(Number(backdatingMaxDays) || 0)),
            gst_default_rate: Math.min(100, Math.max(0, Number(gstDefaultRate) || 0)),
            late_payment_surcharge: {
              enabled: surchargeEnabled,
              pct_per_month: Math.min(100, Math.max(0, Number(surchargePctPerMonth) || 0)),
              grace_days: Math.max(0, Math.floor(Number(surchargeGraceDays) || 0)),
            },
          },
        },
      });
      setFacility(updated);
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-gray-500 p-4">Loading…</div>;
  if (!facility) return <div className="text-red-700 p-4">{error ?? 'Failed to load facility'}</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>

      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Facility Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">City *</span>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity((e.target as HTMLInputElement).value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-gray-700">Address</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress((e.target as HTMLInputElement).value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone((e.target as HTMLInputElement).value)}
              className="mt-1 w-full border rounded-lg px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">GST Number</span>
            <input
              type="text"
              value={gstNumber}
              onChange={(e) => setGstNumber((e.target as HTMLInputElement).value)}
              className="mt-1 w-full border rounded-lg px-3 py-2 font-mono"
            />
          </label>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Operational Settings</h2>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Weight Dispute Threshold (kg)</span>
          <input
            type="number"
            value={weightThreshold}
            onChange={(e) => setWeightThreshold((e.target as HTMLInputElement).value)}
            className="mt-1 w-full md:w-48 border rounded-lg px-3 py-2"
            min={0}
          />
          <span className="text-xs text-gray-500 mt-1 block">
            Lots whose accepted weight differs from declared by ≥ this many kg are flagged.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Chamber Capacity Warning (%)</span>
          <input
            type="number"
            value={chamberWarningPct}
            onChange={(e) => setChamberWarningPct((e.target as HTMLInputElement).value)}
            className="mt-1 w-full md:w-48 border rounded-lg px-3 py-2"
            min={1}
            max={100}
          />
          <span className="text-xs text-gray-500 mt-1 block">
            Inbound shows a warning when a chamber would exceed this occupancy after the new lot.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Max Backdating (days)</span>
          <input
            type="number"
            value={backdatingMaxDays}
            placeholder="Unlimited"
            onChange={(e) => setBackdatingMaxDays((e.target as HTMLInputElement).value)}
            className="mt-1 w-full md:w-48 border rounded-lg px-3 py-2"
            min={0}
          />
          <span className="text-xs text-gray-500 mt-1 block">
            How far in the past operators may date inbound/outbound entries. Managers and above are
            not limited. Leave empty for unlimited.
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gstRegistered}
            onChange={(e) => setGstRegistered((e.target as HTMLInputElement).checked)}
          />
          <span className="text-sm font-medium text-gray-700">GST Registered</span>
        </label>

        {gstRegistered && (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Default GST Rate (%)</span>
            <input
              type="number"
              value={gstDefaultRate}
              onChange={(e) => setGstDefaultRate((e.target as HTMLInputElement).value)}
              className="mt-1 w-full md:w-48 border rounded-lg px-3 py-2"
              min={0}
              max={100}
              step="0.5"
            />
            <span className="text-xs text-gray-500 mt-1 block">
              Pre-filled on new invoices. Can still be changed per invoice while in draft.
            </span>
          </label>
        )}

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Number Format</span>
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="numberFormat"
                checked={numberFormat === 'en-PK'}
                onChange={() => setNumberFormat('en-PK')}
              />
              en-PK (1,00,000)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="numberFormat"
                checked={numberFormat === 'en-IN'}
                onChange={() => setNumberFormat('en-IN')}
              />
              en-IN (1,00,000)
            </label>
          </div>
        </label>

        <div>
          <span className="text-sm font-medium text-gray-700">Storage Alert Thresholds (days)</span>
          <p className="text-xs text-gray-500 mt-1 mb-2">
            Per-commodity day count. Lot Aging report flags lots in storage longer than the value here.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase text-gray-500">
                <th className="text-left py-1">Commodity</th>
                <th className="text-right">Threshold (days)</th>
              </tr>
            </thead>
            <tbody>
              {commodities.length === 0 ? (
                <tr><td colSpan={2} className="text-gray-500 py-3 text-center">No commodities configured.</td></tr>
              ) : (
                commodities.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1">{c.name}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        value={alertThresholds[c.id] ?? ''}
                        placeholder="—"
                        onChange={(e) => {
                          const raw = (e.target as HTMLInputElement).value;
                          setAlertThresholds((prev) => {
                            const next = { ...prev };
                            if (raw === '') delete next[c.id];
                            else next[c.id] = Number(raw);
                            return next;
                          });
                        }}
                        className="w-24 border rounded px-2 py-1 text-right"
                        min={1}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Late Payment Surcharge</h2>
        <p className="text-xs text-gray-500">
          When enabled, overdue invoices appear on the surcharge suggestions screen where the
          accountant can apply the computed surcharge with one click. Nothing is charged
          automatically.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={surchargeEnabled}
            onChange={(e) => setSurchargeEnabled((e.target as HTMLInputElement).checked)}
          />
          <span className="text-sm font-medium text-gray-700">Enable surcharge suggestions</span>
        </label>
        {surchargeEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Rate (% per month)</span>
              <input
                type="number"
                value={surchargePctPerMonth}
                onChange={(e) => setSurchargePctPerMonth((e.target as HTMLInputElement).value)}
                className="mt-1 w-full border rounded-lg px-3 py-2"
                min={0}
                max={100}
                step="0.25"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Grace Period (days)</span>
              <input
                type="number"
                value={surchargeGraceDays}
                onChange={(e) => setSurchargeGraceDays((e.target as HTMLInputElement).value)}
                className="mt-1 w-full border rounded-lg px-3 py-2"
                min={0}
              />
              <span className="text-xs text-gray-500 mt-1 block">
                Days after the invoice date before surcharge months start counting.
              </span>
            </label>
          </div>
        )}
      </section>

      {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
      {savedAt && (
        <div className="text-emerald-700 bg-emerald-50 px-3 py-2 rounded text-sm">
          Saved at {new Date(savedAt).toLocaleTimeString()}
        </div>
      )}

      <div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
