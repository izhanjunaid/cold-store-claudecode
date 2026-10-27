'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { round2 } from '@coldchain/shared';
import { apiClient, ApiError } from '@/lib/api-client';
import { can } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import { formatMoney } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { MODES, type CheckoutPreview, type Mode } from './checkout-sheet';

interface TruckGroup {
  billing_party: { id: string; name: string };
  book_type: 'PACCI' | 'KATCHI';
  outbound_ids: string[];
  total_pkr: number;
  /** For the munshi alone: does the party's standing approval cover all its bills on this truck? */
  credit_available: boolean;
}

export interface TruckPreview {
  gate_pass_id: string;
  pass_number: string;
  vehicle_number: string;
  lines: CheckoutPreview[];
  not_ready: string[];
  groups: TruckGroup[];
  total_pkr: number;
  solo: { allowed: boolean; reason?: string };
}

export interface TruckResult {
  gate_pass_id: string;
  payments: { id: string; receipt_number: string | null; billing_party_id: string; book_type: string; amount_pkr: number }[];
}

type Payment = { mode: Mode; reference: string; chequeDate: string };
const groupKey = (g: { billing_party: { id: string }; book_type: string }) => `${g.billing_party.id}:${g.book_type}`;

/**
 * Check out a whole truck: every weighed lot on it dispatched and billed, the money taken once
 * per paying party (one receipt each) — one transaction, or nothing. The same review as the
 * one-lot sheet, line by line; the server refuses it if any bill or the load changed meanwhile.
 */
export function TruckCheckoutSheet({
  open,
  onOpenChange,
  passId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passId: string;
  onDone: (result: TruckResult) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const holdsKeys = can(user, 'invoices.manage') && can(user, 'outbound.finalize');
  const canCollect = can(user, 'payments.record');
  const previewKey = ['dispatch', 'truck-preview', passId];

  const [skipped, setSkipped] = useState<Set<string>>(new Set()); // `${outbound_id}:${service_charge_id}`
  const [pay, setPay] = useState<Record<string, Payment>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading, error: loadError } = useQuery({
    queryKey: previewKey,
    queryFn: () => apiClient<TruckPreview>(`/v1/dispatch/trucks/${passId}/checkout-preview`),
    enabled: open && !!passId,
    staleTime: 0, // a bill that changed under the sheet must be seen again, never reused
  });

  useEffect(() => {
    if (open) {
      setSkipped(new Set());
      setPay({});
      setError(null);
    }
  }, [open, passId]);

  const solo = !holdsKeys && !!preview?.solo.allowed;
  const canFinish = holdsKeys || solo;
  const defaultMode: Mode = holdsKeys && !canCollect ? 'CREDIT' : 'CASH';
  const paymentOf = (g: TruckGroup): Payment => pay[groupKey(g)] ?? { mode: defaultMode, reference: '', chequeDate: '' };
  const setPayment = (g: TruckGroup, patch: Partial<Payment>) => setPay((p) => ({ ...p, [groupKey(g)]: { ...paymentOf(g), ...patch } }));
  const modeOffered = (g: TruckGroup, m: Mode) =>
    holdsKeys ? m === 'CREDIT' || canCollect : solo ? m === 'CASH' || (m === 'CREDIT' && g.credit_available) : false;

  // The server's arithmetic (invoiceTotals): subtotal to the paisa, then GST on it.
  const lineTotal = (l: CheckoutPreview) => {
    const kept = l.service_lines.filter((s) => !skipped.has(`${l.outbound_id}:${s.service_charge_id}`));
    const sub = round2(l.storage_line.amount_pkr + kept.reduce((s, x) => s + x.amount_pkr, 0));
    return round2(sub + round2(sub * (l.gst_rate / 100)));
  };
  const lines = preview?.lines ?? [];
  const total = round2(lines.reduce((s, l) => s + lineTotal(l), 0));

  const groupBlocked = (g: TruckGroup) => {
    const p = paymentOf(g);
    const needsReference = p.mode === 'BANK_TRANSFER' || p.mode === 'MOBILE_WALLET';
    return !modeOffered(g, p.mode) || (p.mode === 'CHEQUE' && !p.chequeDate) || (needsReference && !p.reference.trim());
  };
  const blocked = !canFinish || !preview || preview.not_ready.length > 0 || lines.length === 0 || preview.groups.some(groupBlocked);

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient<TruckResult>(`/v1/dispatch/trucks/${passId}/dispatch-and-collect`, {
        method: 'POST',
        body: {
          lines: lines.map((l) => {
            const skip = l.service_lines.map((s) => s.service_charge_id).filter((id) => skipped.has(`${l.outbound_id}:${id}`));
            return { outbound_id: l.outbound_id, expected_total_pkr: lineTotal(l), ...(skip.length > 0 ? { skip_service_charge_ids: skip } : {}) };
          }),
          payments: preview.groups.map((g) => {
            const p = paymentOf(g);
            return {
              billing_party_id: g.billing_party.id,
              book_type: g.book_type,
              mode: p.mode,
              ...(p.reference.trim() ? { reference_number: p.reference.trim() } : {}),
              ...(p.mode === 'CHEQUE' ? { cheque_date: p.chequeDate } : {}),
            };
          }),
        },
      });
      toast.success(`Truck ${preview.vehicle_number} checked out — ${formatMoney(total)}`);
      queryClient.invalidateQueries({ queryKey: qk.outbound.lists });
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'trucks'] });
      onOpenChange(false);
      onDone(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OUTBOUND_ALREADY_FINALIZED') {
        // Someone else (or a retry) checked it out first: it is done, and the truck card prints the slip.
        toast.message('This truck was already checked out — print its load slip from the truck card.');
        queryClient.invalidateQueries({ queryKey: qk.outbound.lists });
        queryClient.invalidateQueries({ queryKey: ['dispatch', 'trucks'] });
        onOpenChange(false);
        return;
      }
      if (e instanceof ApiError && (e.code === 'TRUCK_LOAD_CHANGED' || e.code === 'DISPATCH_TOTAL_CHANGED' || e.code === 'TRUCK_NOT_READY')) {
        await queryClient.invalidateQueries({ queryKey: previewKey }); // show the truck as it is now
      }
      setError(e instanceof Error ? e.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Check out truck{preview ? ` — ${preview.vehicle_number}` : ''}</SheetTitle>
          <SheetDescription>{preview ? `Gate pass ${preview.pass_number} · ${lines.length} lots` : 'Review every bill, then collect.'}</SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Pricing the truck…</p>}
          {loadError && <p className="text-sm text-destructive">{loadError instanceof Error ? loadError.message : 'Could not price this truck'}</p>}
          {preview && preview.not_ready.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Weigh or cancel first: {preview.not_ready.join(', ')}.
            </p>
          )}
          {!holdsKeys && preview && !solo && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Checking out this truck needs a manager{preview.solo.reason ? ` — ${preview.solo.reason}` : ''}.
            </p>
          )}

          {preview?.groups.map((g) => {
            const p = paymentOf(g);
            const groupLines = lines.filter((l) => g.outbound_ids.includes(l.outbound_id));
            return (
              <div key={groupKey(g)} data-group className="space-y-2 rounded-md border p-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium" data-group-party>
                    {g.billing_party.name}
                  </span>
                  <span className="text-xs text-muted-foreground">{g.book_type === 'KATCHI' ? 'KATCHI — only the owner takes this money' : 'PACCI'}</span>
                </div>
                {groupLines.map((l) => (
                  <div key={l.outbound_id} className="rounded border text-sm">
                    <div className="flex justify-between px-2 py-1">
                      <span>
                        <span className="font-mono text-xs">{l.dispatch_note_number}</span> · {l.lot_number} · {l.storage_line.description}
                      </span>
                      <span className="tabular-nums">{formatMoney(l.storage_line.amount_pkr)}</span>
                    </div>
                    {l.service_lines.map((s) => {
                      const key = `${l.outbound_id}:${s.service_charge_id}`;
                      const off = skipped.has(key);
                      return (
                        <div key={key} className="flex items-center gap-2 border-t px-2 py-1">
                          <Checkbox
                            id={`svc-${key}`}
                            checked={!off}
                            disabled={!holdsKeys}
                            onCheckedChange={(c) =>
                              setSkipped((prev) => {
                                const next = new Set(prev);
                                if (c) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                          />
                          <Label htmlFor={`svc-${key}`} className={off ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}>
                            {s.description}
                          </Label>
                          <span className="tabular-nums">{off ? '—' : formatMoney(s.amount_pkr)}</span>
                        </div>
                      );
                    })}
                    <div className="flex justify-between border-t bg-muted/40 px-2 py-1 font-medium">
                      <span>Bill{l.gst_rate > 0 ? ` (with GST ${l.gst_rate}%)` : ''}</span>
                      <span className="tabular-nums">{formatMoney(lineTotal(l))}</span>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  {MODES.map((m) => (
                    <Button
                      key={m.value}
                      type="button"
                      size="sm"
                      variant={p.mode === m.value ? 'default' : 'outline'}
                      disabled={!modeOffered(g, m.value)}
                      onClick={() => setPayment(g, { mode: m.value })}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                {(p.mode === 'BANK_TRANSFER' || p.mode === 'MOBILE_WALLET' || p.mode === 'CHEQUE') && (
                  <Input
                    aria-label={`${p.mode === 'CHEQUE' ? 'Cheque number' : 'Transfer reference'} — ${g.billing_party.name}`}
                    value={p.reference}
                    onChange={(e) => setPayment(g, { reference: e.target.value })}
                  />
                )}
                {p.mode === 'CHEQUE' && (
                  <Input
                    type="date"
                    aria-label={`Cheque date — ${g.billing_party.name}`}
                    value={p.chequeDate}
                    onChange={(e) => setPayment(g, { chequeDate: e.target.value })}
                  />
                )}
              </div>
            );
          })}

          {error && (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </SheetBody>

        <SheetFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={blocked || submitting}>
            {submitting ? 'Working…' : `Check out truck ${formatMoney(total)}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
