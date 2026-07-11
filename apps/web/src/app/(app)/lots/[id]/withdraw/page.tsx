'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { useLotPlacements } from '@/components/lot-location';
import { StatusBadge } from '@/components/ui/status-badge';

import { PageSkeleton } from '@/components/page-skeleton';
interface Lot {
  id: string;
  lot_number: string;
  status: string;
  owner_party_name: string | null;
  commodity_name: string | null;
  current_balance_bags: number;
}
interface Party {
  id: string;
  name: string;
  party_type: string;
  is_active: boolean;
}

export default function WithdrawPage() {
  const params = useParams();
  const router = useRouter();
  const lotId = params['id'] as string;

  const [lot, setLot] = useState<Lot | null>(null);
  const { data: location } = useLotPlacements(lotId);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    withdrawal_type: 'FULL' as 'FULL' | 'PARTIAL',
    quantity_withdrawn_bags: '',
    outbound_date: new Date().toISOString().slice(0, 10),
    receiving_party_id: '',
    vehicle_number: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLot(await apiClient<Lot>(`/v1/lots/${lotId}`));
      const partyRes = await apiClient<{ data: Party[] } | Party[]>('/v1/parties?is_active=true&per_page=100');
      const list = Array.isArray(partyRes) ? partyRes : partyRes.data;
      setParties(list.filter((p) => p.is_active));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!lot) return;
    if (form.withdrawal_type === 'PARTIAL') {
      const qty = Number(form.quantity_withdrawn_bags);
      if (!qty || qty <= 0) return setError('Enter number of bags to withdraw');
      if (qty >= lot.current_balance_bags)
        return setError(
          `Partial quantity must be less than current balance (${lot.current_balance_bags}). Use FULL to withdraw the whole lot.`,
        );
    }
    setSubmitting(true);
    try {
      const qty = form.withdrawal_type === 'FULL' ? lot.current_balance_bags : Number(form.quantity_withdrawn_bags);
      const body: Record<string, unknown> = {
        lot_id: lotId,
        withdrawal_type: form.withdrawal_type,
        quantity_withdrawn_bags: qty,
        outbound_date: form.outbound_date,
      };
      if (form.receiving_party_id) body['receiving_party_id'] = form.receiving_party_id;
      if (form.vehicle_number) body['vehicle_number'] = form.vehicle_number;
      if (form.notes) body['notes'] = form.notes;
      const res = await apiClient<{ id: string }>('/v1/outbound-events', { method: 'POST', body });
      router.push(`/outbound-events/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!lot) return <p className="text-destructive">Lot not found.</p>;
  if (lot.status !== 'ACTIVE')
    return (
      <div>
        <p className="mb-4 text-destructive">Lot is {lot.status}; withdrawals require ACTIVE status.</p>
        <Button variant="outline" onClick={() => router.push(`/lots/${lotId}`)}>
          Back to Lot
        </Button>
      </div>
    );

  return (
    <div className="max-w-4xl">
      <PageHeader title="New Withdrawal" crumb="Withdraw" />

      <Card className="mb-5 bg-muted/30">
        <CardContent className="grid grid-cols-2 gap-3 pt-6 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Lot</div>
            <div className="font-mono font-medium">{lot.lot_number}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Owner</div>
            <div className="font-medium">{lot.owner_party_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Commodity</div>
            <div>{lot.commodity_name ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current Balance</div>
            <div className="font-medium text-primary-700">{lot.current_balance_bags.toLocaleString()} bags</div>
          </div>
          {location && (
            <div className="col-span-full border-t pt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Pick from</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{location.chamber_name ?? 'Room'}</span>
                {location.placements.map((p) => (
                  <StatusBadge
                    key={p.rack_id}
                    status={`${p.rack_name} × ${p.bags.toLocaleString()}`}
                    tone="neutral"
                    raw
                    className="tabular-nums"
                  />
                ))}
                {location.unplaced_bags > 0 && (
                  <StatusBadge
                    status={`Unplaced × ${location.unplaced_bags.toLocaleString()}`}
                    tone="warning"
                    raw
                    className="tabular-nums"
                  />
                )}
                {location.placements.length === 0 && location.unplaced_bags === 0 && (
                  <span className="text-sm text-muted-foreground">No placement recorded.</span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <EntrySheet autoFocus={false}>
          <EntryGroup title="Withdrawal" columns={4}>
            <div className="col-span-full">
              <Label className="mb-2 block">Withdrawal type</Label>
              <div className="flex gap-2">
                {(['FULL', 'PARTIAL'] as const).map((t) => (
                  <Button
                    type="button"
                    key={t}
                    variant={form.withdrawal_type === t ? 'default' : 'outline'}
                    onClick={() => setForm({ ...form, withdrawal_type: t })}
                  >
                    {t === 'FULL' ? `Full (${lot.current_balance_bags} bags)` : 'Partial'}
                  </Button>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {form.withdrawal_type === 'FULL'
                  ? 'All remaining bags dispatched; lot will close after finalization.'
                  : 'Specify how many bags to withdraw; remaining stay in storage.'}
              </p>
            </div>

            {form.withdrawal_type === 'PARTIAL' && (
              <div className="space-y-1.5">
                <Label>
                  Bags to withdraw <span className="text-destructive">*</span>{' '}
                  <span className="font-normal text-muted-foreground">(max {lot.current_balance_bags - 1})</span>
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={lot.current_balance_bags - 1}
                  value={form.quantity_withdrawn_bags}
                  onChange={(e) => setForm({ ...form, quantity_withdrawn_bags: e.target.value })}
                  className="tabular-nums"
                  required
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Outbound date <span className="text-destructive">*</span></Label>
              <Input
                type="date"
                value={form.outbound_date}
                onChange={(e) => setForm({ ...form, outbound_date: e.target.value })}
                className="tabular-nums"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Vehicle number</Label>
              <Input
                type="text"
                maxLength={20}
                value={form.vehicle_number}
                onChange={(e) => setForm({ ...form, vehicle_number: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Receiving party</Label>
              <select
                value={form.receiving_party_id}
                onChange={(e) => setForm({ ...form, receiving_party_id: e.target.value })}
                className={cn(
                  'flex w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
              >
                <option value="">— Optional —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.party_type})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={1}
                placeholder="Optional"
              />
            </div>
          </EntryGroup>
        </EntrySheet>

        <FormActions>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Withdrawal'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.push(`/lots/${lotId}`)}>
            Cancel
          </Button>
        </FormActions>
      </form>
    </div>
  );
}
