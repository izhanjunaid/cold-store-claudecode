'use client';

import { useState, useEffect, useCallback } from 'react';
import { fromIsoDate, localIsoDate, normalizePlate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { hasMinRole } from '@/lib/rbac';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { PartyPicker } from '@/components/party/party-picker';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { MASKS, MASK_PLACEHOLDER } from '@/components/form/masks';
import { useLotPlacements } from '@/components/lot-location';
import { useFacility } from '@/hooks/use-reference-data';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageSkeleton } from '@/components/page-skeleton';

interface Lot {
  id: string;
  lot_number: string;
  status: string;
  owner_party_id: string;
  owner_party_name: string | null;
  billing_party_id: string;
  billing_party_name: string | null;
  commodity_name: string | null;
  current_balance_bags: number;
}
interface BillingPartyCredit {
  credit_limit_pkr: number | null;
  over_credit_limit?: boolean;
}

export interface WithdrawFormProps {
  lotId: string;
  /** `sheet`: the form owns the only scroll region so the submit row stays pinned (as PaymentForm does). */
  variant?: 'page' | 'sheet';
  onCreated: (outboundId: string) => void;
  onCancel: () => void;
  /** Plates of trucks inside the store; one tap fills the vehicle field with a plate the gate will match exactly. */
  plateSuggestions?: string[];
}

/**
 * Book a withdrawal against one lot. One form, two homes: the full page at
 * `/lots/[id]/withdraw` (kept as the deep link) and the drawer opened from lot
 * rows (`WithdrawSheet`) — the same split as `/payments/new` and `PaymentForm`.
 */
export function WithdrawForm({ lotId, variant = 'page', onCreated, onCancel, plateSuggestions }: WithdrawFormProps) {
  const user = useAuthStore((s) => s.user);

  const [lot, setLot] = useState<Lot | null>(null);
  const { data: location } = useLotPlacements(lotId);
  const { data: facility } = useFacility();
  const [billingCredit, setBillingCredit] = useState<BillingPartyCredit | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    withdrawal_type: 'FULL' as 'FULL' | 'PARTIAL',
    quantity_withdrawn_bags: '',
    // The viewer's calendar day: the UTC date read as yesterday before 05:00 in Lahore.
    outbound_date: localIsoDate(),
    receiving_party_id: '',
    third_party_release: false,
    vehicle_number: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const loadedLot = await apiClient<Lot>(`/v1/lots/${lotId}`);
      setLot(loadedLot);
      if (loadedLot.billing_party_id) {
        setBillingCredit(await apiClient<BillingPartyCredit>(`/v1/parties/${loadedLot.billing_party_id}`));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  useEffect(() => {
    load();
  }, [load]);

  // Server enforcement (outbound.service.ts) only rejects this on submit for
  // OPERATOR-level users; surface it here too so it isn't a surprise error.
  // Both sides are calendar dates (UTC midnights), so the difference is whole days.
  const backdatingMaxDays = facility?.settings?.backdating_max_days ?? null;
  const today = localIsoDate();
  const daysBack = form.outbound_date
    ? Math.round((fromIsoDate(today).getTime() - fromIsoDate(form.outbound_date).getTime()) / 86_400_000)
    : 0;
  const isBackdated = backdatingMaxDays !== null && daysBack > backdatingMaxDays;
  // The server refuses a future date below MANAGER (DATE_IN_FUTURE).
  const isFutureDated = !!form.outbound_date && form.outbound_date > today;

  // Goods going to anyone but the current owner is a third-party release: the
  // server wants it flagged, and only a manager may flag it (a fixed seniority
  // rule outside the permission matrix).
  const isManager = hasMinRole(user?.role, 'MANAGER');
  const isThirdParty = !!lot && !!form.receiving_party_id && form.receiving_party_id !== lot.owner_party_id;
  const blockedThirdParty = isThirdParty && !isManager;

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
    // The gate matches the outgoing truck by its plate, so it is not optional here.
    const plate = form.vehicle_number.trim();
    if (normalizePlate(plate).length < 2) return setError("Enter the truck's number plate");
    if (blockedThirdParty) return setError('Releasing to someone other than the owner needs a manager.');
    if (isThirdParty && !form.third_party_release)
      return setError('Tick “Third-party release” to confirm, or pick the owner as receiver.');
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
      if (isThirdParty && form.third_party_release) body['third_party_release'] = true;
      body['vehicle_number'] = plate;
      if (form.notes) body['notes'] = form.notes;
      const res = await apiClient<{ id: string }>('/v1/outbound-events', { method: 'POST', body });
      onCreated(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Withdrawal failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!lot) return <p className="text-destructive">{error ?? 'Lot not found.'}</p>;
  if (lot.status !== 'ACTIVE')
    return (
      <div>
        <p className="mb-4 text-destructive">Lot is {lot.status}; withdrawals require ACTIVE status.</p>
        <Button variant="outline" onClick={onCancel}>
          {variant === 'sheet' ? 'Close' : 'Back to Lot'}
        </Button>
      </div>
    );

  const fields = (
    <>
      {billingCredit?.over_credit_limit && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {lot.billing_party_name ?? 'Billing party'} is over credit limit. This does not block withdrawal.
        </div>
      )}

      <Card className="bg-muted/30">
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

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <EntrySheet autoFocus={false}>
        <EntryGroup title="Withdrawal" columns={variant === 'sheet' ? 2 : 4}>
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
            <Label htmlFor="outbound_date">Outbound date <span className="text-destructive">*</span></Label>
            <Input
              id="outbound_date"
              type="date"
              value={form.outbound_date}
              onChange={(e) => setForm({ ...form, outbound_date: e.target.value })}
              className="tabular-nums"
              required
            />
            {isBackdated && (
              <p className="text-xs text-amber-600">
                Backdated {daysBack} days — manager approval required.
              </p>
            )}
            {isFutureDated && (
              <p className="text-xs text-amber-600">Future date — only a manager can save this.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vehicle_number">
              Vehicle number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="vehicle_number"
              name="vehicle_number"
              type="text"
              required
              maxLength={20}
              autoComplete="off"
              value={form.vehicle_number}
              onChange={(e) => setForm({ ...form, vehicle_number: MASKS.vehicle(e.target.value) })}
              placeholder={MASK_PLACEHOLDER.vehicle}
            />
            {plateSuggestions && plateSuggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Trucks inside">
                <span className="text-xs text-muted-foreground">Inside:</span>
                {plateSuggestions.map((plate) => (
                  <Button
                    key={plate}
                    type="button"
                    size="sm"
                    variant={form.vehicle_number === plate ? 'default' : 'outline'}
                    className="h-6 px-2 font-mono text-xs"
                    onClick={() => setForm({ ...form, vehicle_number: MASKS.vehicle(plate) })}
                  >
                    {plate}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">The gate checks the truck by this plate.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Receiving party</Label>
            <PartyPicker
              clearable
              value={form.receiving_party_id}
              // A new receiver needs the third-party box ticked afresh.
              onChange={(v) => setForm({ ...form, receiving_party_id: v, third_party_release: false })}
              placeholder="— Optional —"
              testId="combobox-receiving_party_id"
            />
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

          {isThirdParty && (
            <div className="col-span-full">
              {isManager ? (
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox
                    checked={form.third_party_release}
                    onCheckedChange={(c) => setForm({ ...form, third_party_release: !!c })}
                  />
                  Third-party release — goods go to someone other than the owner
                </label>
              ) : (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  Releasing to someone other than the owner needs a manager.
                </div>
              )}
            </div>
          )}
        </EntryGroup>
      </EntrySheet>
    </>
  );

  const actions = (
    <FormActions>
      <Button type="submit" disabled={submitting || blockedThirdParty}>
        {submitting ? 'Creating…' : 'Create Withdrawal'}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </FormActions>
  );

  if (variant === 'sheet') {
    return (
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="-mx-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-4">{fields}</div>
        <div className="shrink-0">{actions}</div>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {fields}
      {actions}
    </form>
  );
}
