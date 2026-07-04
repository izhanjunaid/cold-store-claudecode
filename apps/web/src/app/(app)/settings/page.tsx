'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import type { FacilityResponseType } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

import { PageSkeleton } from '@/components/page-skeleton';
interface Commodity {
  id: string;
  name: string;
}

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [facility, setFacility] = useState<FacilityResponseType | null>(null);
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const [backdatingMaxDays, setBackdatingMaxDays] = useState('');
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
        setBackdatingMaxDays(f.settings.backdating_max_days == null ? '' : String(f.settings.backdating_max_days));
        setGstDefaultRate(String(f.settings.gst_default_rate ?? 18));
        setSurchargeEnabled(f.settings.late_payment_surcharge?.enabled ?? false);
        setSurchargePctPerMonth(String(f.settings.late_payment_surcharge?.pct_per_month ?? 2));
        setSurchargeGraceDays(String(f.settings.late_payment_surcharge?.grace_days ?? 30));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
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
            backdating_max_days: backdatingMaxDays.trim() === '' ? null : Math.max(0, Math.floor(Number(backdatingMaxDays) || 0)),
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
      toast.success('Settings saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!facility) return <p className="text-destructive">{error ?? 'Failed to load facility'}</p>;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="System Settings"
        description="Facility profile and operational policy"
        actions={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>}
      />

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-sm">Facility Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
            <Field label="Address" className="md:col-span-2"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="GST Number"><Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} className="font-mono" /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Operational Settings</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Weight Dispute Threshold (kg)" hint="Flag lots whose accepted vs declared weight differs by ≥ this many kg.">
                <Input type="number" min={0} value={weightThreshold} onChange={(e) => setWeightThreshold(e.target.value)} className="tabular-nums" />
              </Field>
              <Field label="Chamber Capacity Warning (%)" hint="Warn when a chamber would exceed this occupancy after a new lot.">
                <Input type="number" min={1} max={100} value={chamberWarningPct} onChange={(e) => setChamberWarningPct(e.target.value)} className="tabular-nums" />
              </Field>
              <Field label="Max Backdating (days)" hint="How far back operators may date entries. Empty = unlimited; managers+ exempt.">
                <Input type="number" min={0} value={backdatingMaxDays} placeholder="Unlimited" onChange={(e) => setBackdatingMaxDays(e.target.value)} className="tabular-nums" />
              </Field>
            </div>

            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={gstRegistered} onCheckedChange={(c) => setGstRegistered(!!c)} />
              GST Registered
            </label>
            {gstRegistered && (
              <Field label="Default GST Rate (%)" hint="Pre-filled on new invoices; editable per draft invoice." className="md:w-64">
                <Input type="number" min={0} max={100} step={0.5} value={gstDefaultRate} onChange={(e) => setGstDefaultRate(e.target.value)} className="tabular-nums" />
              </Field>
            )}

            <div>
              <Label className="mb-2 block">Number Format</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="radio" name="numberFormat" checked={numberFormat === 'en-PK'} onChange={() => setNumberFormat('en-PK')} /> en-PK (1,00,000)</label>
                <label className="flex items-center gap-2"><input type="radio" name="numberFormat" checked={numberFormat === 'en-IN'} onChange={() => setNumberFormat('en-IN')} /> en-IN (1,00,000)</label>
              </div>
            </div>

            <div>
              <Label className="mb-1 block">Storage Alert Thresholds (days)</Label>
              <p className="mb-2 text-xs text-muted-foreground">Per-commodity day count; Lot Aging flags lots older than this.</p>
              <div className="max-h-80 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Commodity</TableHead>
                    <TableHead className="text-right">Threshold (days)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commodities.length === 0 ? (
                    <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No commodities configured.</TableCell></TableRow>
                  ) : (
                    commodities.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.name}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            value={alertThresholds[c.id] ?? ''}
                            placeholder="—"
                            onChange={(e) => {
                              const raw = e.target.value;
                              setAlertThresholds((prev) => {
                                const next = { ...prev };
                                if (raw === '') delete next[c.id];
                                else next[c.id] = Number(raw);
                                return next;
                              });
                            }}
                            className="ml-auto h-8 w-24 text-right tabular-nums"
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Late Payment Surcharge</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              When enabled, overdue invoices appear on the surcharge suggestions screen for one-click
              application. Nothing is charged automatically.
            </p>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={surchargeEnabled} onCheckedChange={(c) => setSurchargeEnabled(!!c)} />
              Enable surcharge suggestions
            </label>
            {surchargeEnabled && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Rate (% per month)">
                  <Input type="number" min={0} max={100} step={0.25} value={surchargePctPerMonth} onChange={(e) => setSurchargePctPerMonth(e.target.value)} className="tabular-nums" />
                </Field>
                <Field label="Grace Period (days)" hint="Days after invoice date before surcharge months count.">
                  <Input type="number" min={0} value={surchargeGraceDays} onChange={(e) => setSurchargeGraceDays(e.target.value)} className="tabular-nums" />
                </Field>
              </div>
            )}
          </CardContent>
        </Card>

        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>
      </div>
    </div>
  );
}
