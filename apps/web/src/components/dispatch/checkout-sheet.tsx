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
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface CheckoutPreview {
  outbound_id: string;
  dispatch_note_number: string | null;
  lot_number: string;
  billing_party: { id: string; name: string };
  book_type: 'PACCI' | 'KATCHI';
  quantity_withdrawn_bags: number;
  outbound_weight_kg: number | null;
  period_start: string;
  period_end: string;
  storage_line: { description: string; quantity: number; unit_price_pkr: number; amount_pkr: number; days: number };
  service_lines: {
    service_charge_id: string;
    description: string;
    quantity: number;
    unit_price_pkr: number;
    amount_pkr: number;
  }[];
  sub_total_pkr: number;
  gst_rate: number;
  gst_amount_pkr: number;
  total_pkr: number;
}

export interface CheckoutResult {
  outbound: { id: string; dispatch_note_number: string | null };
  invoice: { id: string; invoice_number: string | null; total_pkr: number };
  payment: { id: string; receipt_number: string | null } | null;
}

const MODES = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'MOBILE_WALLET', label: 'Mobile wallet' },
  { value: 'CREDIT', label: 'On credit' },
] as const;
type Mode = (typeof MODES)[number]['value'];

/**
 * Dispatch a weighed withdrawal, finalize its bill and take the money — one button,
 * one transaction. The sheet is the review: storage as the server priced it, the
 * charges that go on every dispatch (removable, deliberately), GST and the total; the
 * button names the amount, and the server refuses it if the bill changed meanwhile.
 */
export function CheckoutSheet({
  open,
  onOpenChange,
  outboundId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outboundId: string;
  onDone: (result: CheckoutResult) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const holdsKeys = can(user, 'invoices.manage') && can(user, 'outbound.finalize');
  const canCollect = can(user, 'payments.record');

  const [mode, setMode] = useState<Mode>('CASH');
  const [reference, setReference] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: preview,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: qk.outbound.preview(outboundId),
    queryFn: () => apiClient<CheckoutPreview>(`/v1/outbound-events/${outboundId}/checkout-preview`),
    enabled: open && !!outboundId,
    // A bill that changed under the sheet must be seen again, never reused.
    staleTime: 0,
  });

  useEffect(() => {
    if (open) {
      setMode(canCollect ? 'CASH' : 'CREDIT');
      setReference('');
      setChequeDate('');
      setSkipped(new Set());
      setError(null);
    }
  }, [open, outboundId, canCollect]);

  // The same arithmetic the server applies when it builds and re-prices the bill.
  const keptServices = preview?.service_lines.filter((l) => !skipped.has(l.service_charge_id)) ?? [];
  const subTotal = round2((preview?.storage_line.amount_pkr ?? 0) + keptServices.reduce((s, l) => s + l.amount_pkr, 0));
  const gst = round2(subTotal * ((preview?.gst_rate ?? 0) / 100));
  const total = round2(subTotal + gst);

  const needsReference = mode === 'BANK_TRANSFER' || mode === 'MOBILE_WALLET';
  const blocked =
    !holdsKeys ||
    (mode !== 'CREDIT' && !canCollect) ||
    (mode === 'CHEQUE' && !chequeDate) ||
    (needsReference && reference.trim().length === 0);

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiClient<CheckoutResult>(`/v1/outbound-events/${outboundId}/dispatch-and-collect`, {
        method: 'POST',
        body: {
          expected_total_pkr: total,
          ...(skipped.size > 0 ? { skip_service_charge_ids: [...skipped] } : {}),
          payment: {
            mode,
            ...(reference.trim() ? { reference_number: reference.trim() } : {}),
            ...(mode === 'CHEQUE' ? { cheque_date: chequeDate } : {}),
          },
        },
      });
      toast.success(mode === 'CREDIT' ? 'Dispatched — bill on credit' : `Dispatched and collected ${formatMoney(total)}`);
      queryClient.invalidateQueries({ queryKey: qk.outbound.all });
      onOpenChange(false);
      onDone(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DISPATCH_TOTAL_CHANGED') {
        // The bill moved under us: show the new one and make them review it again.
        await queryClient.invalidateQueries({ queryKey: qk.outbound.preview(outboundId) });
      }
      setError(e instanceof Error ? e.message : 'Dispatch failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="md">
        <SheetHeader>
          <SheetTitle>
            Dispatch &amp; Collect{preview?.dispatch_note_number ? ` — ${preview.dispatch_note_number}` : ''}
          </SheetTitle>
          <SheetDescription>
            {preview ? `${preview.lot_number} · ${preview.billing_party.name}` : 'Review the bill, then collect.'}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {isLoading && <p className="text-sm text-muted-foreground">Pricing the bill…</p>}
          {loadError && (
            <p className="text-sm text-destructive">
              {loadError instanceof Error ? loadError.message : 'Could not price this withdrawal'}
            </p>
          )}
          {!holdsKeys && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Dispatching and billing a truck needs a manager.
            </p>
          )}

          {preview && (
            <>
              <div className="rounded-md border">
                <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{preview.storage_line.description}</span>
                    <span className="block text-xs text-muted-foreground">
                      {preview.period_start} → {preview.period_end}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatMoney(preview.storage_line.amount_pkr)}</span>
                </div>
                {preview.service_lines.map((l) => {
                  const off = skipped.has(l.service_charge_id);
                  return (
                    <div key={l.service_charge_id} className="flex items-center gap-2 border-t px-3 py-2 text-sm">
                      <Checkbox
                        id={`svc-${l.service_charge_id}`}
                        checked={!off}
                        onCheckedChange={(c) =>
                          setSkipped((prev) => {
                            const next = new Set(prev);
                            if (c) next.delete(l.service_charge_id);
                            else next.add(l.service_charge_id);
                            return next;
                          })
                        }
                      />
                      <Label
                        htmlFor={`svc-${l.service_charge_id}`}
                        className={off ? 'flex-1 text-muted-foreground line-through' : 'flex-1'}
                      >
                        {l.description}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {l.quantity} × {l.unit_price_pkr}
                        </span>
                      </Label>
                      <span className="tabular-nums">{off ? '—' : formatMoney(l.amount_pkr)}</span>
                    </div>
                  );
                })}
                {preview.gst_rate > 0 && (
                  <div className="flex justify-between border-t px-3 py-2 text-sm text-muted-foreground">
                    <span>GST {preview.gst_rate}%</span>
                    <span className="tabular-nums">{formatMoney(gst)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t bg-muted/40 px-3 py-2 font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatMoney(total)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Payment</Label>
                <div className="flex flex-wrap gap-1.5">
                  {MODES.map((m) => (
                    <Button
                      key={m.value}
                      type="button"
                      size="sm"
                      variant={mode === m.value ? 'default' : 'outline'}
                      disabled={m.value !== 'CREDIT' && !canCollect}
                      onClick={() => setMode(m.value)}
                    >
                      {m.label}
                    </Button>
                  ))}
                </div>
                {!canCollect && (
                  <p className="text-xs text-muted-foreground">
                    Taking money needs the payments permission; this one can go on credit.
                  </p>
                )}
              </div>

              {(needsReference || mode === 'CHEQUE') && (
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-ref">{mode === 'CHEQUE' ? 'Cheque number' : 'Transfer reference'}</Label>
                  <Input id="checkout-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              )}
              {mode === 'CHEQUE' && (
                <div className="space-y-1.5">
                  <Label htmlFor="checkout-cheque-date">Cheque date</Label>
                  <Input
                    id="checkout-cheque-date"
                    type="date"
                    value={chequeDate}
                    onChange={(e) => setChequeDate(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">A cheque counts as credit at the gate until it clears.</p>
                </div>
              )}
              {preview.book_type === 'KATCHI' && (
                <p className="text-xs text-amber-700">Informal (KATCHI) book: only the owner can take payment for it.</p>
              )}
            </>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </div>
          )}
        </SheetBody>

        <SheetFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!preview || blocked || submitting}>
            {submitting
              ? 'Working…'
              : mode === 'CREDIT'
                ? `Dispatch on credit ${formatMoney(total)}`
                : `Dispatch & Collect ${formatMoney(total)}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
