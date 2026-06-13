'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';

interface Lot {
  id: string;
  lot_number: string;
  status: string;
  owner_party_id: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  current_balance_bags: number;
}
interface Party {
  id: string;
  name: string;
  type?: string;
  party_type?: string;
  is_active: boolean;
}

export default function TransferNewPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;

  const [lot, setLot] = useState<Lot | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    transfer_type: 'FULL' as 'FULL' | 'PARTIAL',
    to_party_id: '',
    quantity_bags: '',
    transfer_price_pkr: '',
    effective_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const lotRes = await apiClient<Lot>(`/v1/lots/${lotId}`);
      setLot(lotRes);
      const partyRes = await apiClient<{ data: Party[] } | Party[]>('/v1/parties?is_active=true&per_page=100');
      const list = Array.isArray(partyRes) ? partyRes : partyRes.data;
      setParties(list.filter((p) => p.is_active && p.id !== lotRes.owner_party_id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    load();
  }, [load]);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, hint: p.party_type ?? p.type })),
    [parties],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.to_party_id) return setError('Select a new owner');
    if (form.transfer_type === 'PARTIAL') {
      const qty = Number(form.quantity_bags);
      if (!qty || qty <= 0) return setError('Enter bags to transfer');
      if (lot && qty >= lot.current_balance_bags)
        return setError(
          `Partial quantity must be less than current balance (${lot.current_balance_bags}). Use FULL for the whole lot.`,
        );
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        transfer_type: form.transfer_type,
        to_party_id: form.to_party_id,
        effective_date: form.effective_date,
      };
      if (form.transfer_type === 'PARTIAL') body['quantity_bags'] = Number(form.quantity_bags);
      if (form.transfer_price_pkr) body['transfer_price_pkr'] = Number(form.transfer_price_pkr);
      if (form.notes) body['notes'] = form.notes;
      const res = await apiClient<{ transfer_id: string }>(`/v1/lots/${lotId}/transfer`, { method: 'POST', body });
      router.push(`/lots/${lotId}?transfer=${res.transfer_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!lot) return <p className="text-destructive">Lot not found.</p>;
  if (lot.status !== 'ACTIVE')
    return (
      <div>
        <p className="mb-4 text-destructive">Lot is {lot.status}; transfers require ACTIVE status.</p>
        <Button variant="outline" onClick={() => router.push(`/lots/${lotId}`)}>
          Back to Lot
        </Button>
      </div>
    );

  return (
    <div className="max-w-2xl">
      <PageHeader title="Transfer Ownership" crumb="Transfer" />

      <Card className="mb-5 bg-muted/30">
        <CardContent className="grid grid-cols-2 gap-3 pt-6 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Lot</div>
            <div className="font-mono font-medium">{lot.lot_number}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Owner</div>
            <div className="font-medium">{lot.owner_party_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Commodity</div>
            <div>{lot.commodity_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Balance</div>
            <div className="font-medium">{lot.current_balance_bags.toLocaleString()} bags</div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <Label className="mb-2 block">Transfer Type</Label>
              <div className="flex gap-2">
                {(['FULL', 'PARTIAL'] as const).map((t) => (
                  <Button
                    type="button"
                    key={t}
                    variant={form.transfer_type === t ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, transfer_type: t })}
                  >
                    {t === 'FULL' ? 'Full Transfer' : 'Partial Transfer'}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {form.transfer_type === 'FULL'
                  ? 'Entire lot + remaining balance moves to new owner.'
                  : 'Spawns a new child lot for the transferred bags; parent keeps the remainder.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>New Owner <span className="text-destructive">*</span></Label>
              <Combobox
                options={partyOptions}
                value={form.to_party_id}
                onChange={(v) => setForm({ ...form, to_party_id: v })}
                placeholder="Select party…"
                searchPlaceholder="Search parties…"
                testId="combobox-to_party_id"
              />
            </div>

            {form.transfer_type === 'PARTIAL' && (
              <div className="space-y-1.5">
                <Label>
                  Bags to Transfer <span className="text-destructive">*</span>{' '}
                  <span className="font-normal text-muted-foreground">(max {lot.current_balance_bags - 1})</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={lot.current_balance_bags - 1}
                  value={form.quantity_bags}
                  onChange={(e) => setForm({ ...form, quantity_bags: e.target.value })}
                  className="tabular-nums"
                  required
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Effective Date <span className="text-destructive">*</span></Label>
                <Input
                  type="date"
                  value={form.effective_date}
                  onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
                  className="tabular-nums"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label>Transfer Price (PKR)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.transfer_price_pkr}
                  onChange={(e) => setForm({ ...form, transfer_price_pkr: e.target.value })}
                  className="tabular-nums"
                  placeholder="Optional"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                placeholder="Optional"
              />
            </div>

            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Transferring…' : 'Execute Transfer'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push(`/lots/${lotId}`)}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
