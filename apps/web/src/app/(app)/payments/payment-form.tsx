'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import { Info } from 'lucide-react';
import { FormActions, EntrySheet, EntryGroup, EntryChip, EditableRows } from '@/components/form';
import {
  buildAllocationColumns,
  newAllocationRow,
  type AllocationRow,
  type AllocationInvoiceOption,
} from '@/components/billing/allocation-columns';
import { formatMoney } from '@/lib/format';

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface Party {
  id: string;
  name: string;
  party_type?: string;
  is_active: boolean;
}

export interface PaymentFormProps {
  /** Preselects the party but leaves the picker usable. */
  defaultPartyId?: string;
  /**
   * Fixes the party (invoice/party-record context) and renders it as static text
   * instead of a picker. Never set from `/payments/new`: the e2e reaches that route
   * with `?party_id=` already set and still drives `combobox-party_id`, so hiding
   * the picker there would fail the spec.
   */
  lockPartyId?: boolean;
  /** Shown in place of the picker when `lockPartyId` is set. */
  partyName?: string;
  /** Pre-fills a single allocation row at this invoice's full balance. */
  defaultInvoiceId?: string;
  defaultInvoiceBalance?: number;
  /** Grid width. 6 suits a full page; a drawer should pass 3 or fewer. */
  columns?: 2 | 3 | 4 | 6;
  /**
   * 'sheet' makes the fields the only scrolling region so the submit row stays
   * pinned to the drawer's bottom edge. On a page the whole form scrolls with
   * `<main>` and FormActions sticks to the viewport instead.
   */
  variant?: 'page' | 'sheet';
  onCreated: (payment: { id: string }) => void;
  onCancel: () => void;
}

/**
 * Shared by the full-page `/payments/new` route (a command-palette deep-link
 * target and the e2e's entry point) and the Record Payment drawer mounted on the
 * payments list, an invoice, and a party record — same fields, same validation,
 * same double-submit guard. The caller decides what "done" means via `onCreated`
 * (navigate vs. close-and-refresh). A fresh instance mounts per attempt in both
 * places (the page navigates away; the drawer unmounts on close), which is what
 * makes the never-reset `submittingRef` safe.
 */
/** Grows a <textarea> to fit its content instead of reserving fixed height
 * for an almost-always-empty field. `field-sizing: content` will replace this
 * once it's universally supported; until then this is the standard fallback. */
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function PaymentForm({
  defaultPartyId = '',
  lockPartyId = false,
  partyName,
  defaultInvoiceId,
  defaultInvoiceBalance,
  columns = 6,
  variant = 'page',
  onCreated,
  onCancel,
}: PaymentFormProps) {
  const [parties, setParties] = useState<Party[]>([]);
  const [invoices, setInvoices] = useState<AllocationInvoiceOption[]>([]);
  const [error, setError] = useState('');

  const [partyId, setPartyId] = useState(defaultPartyId);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amountPkr, setAmountPkr] = useState(
    defaultInvoiceBalance != null ? String(defaultInvoiceBalance) : '',
  );
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [taxWithheld, setTaxWithheld] = useState('');
  const [isAdvance, setIsAdvance] = useState(false);
  const [chequeDate, setChequeDate] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<AllocationRow[]>(() =>
    defaultInvoiceId
      ? [
          {
            invoice_id: defaultInvoiceId,
            allocated_amount_pkr:
              defaultInvoiceBalance != null ? String(defaultInvoiceBalance) : '',
          },
        ]
      : [],
  );

  // Synchronous guard: `isPending` only disables the button on the next render,
  // leaving a window where rapid clicks fire multiple POSTs (duplicate receipts).
  const submittingRef = useRef(false);

  // The picker is the only reason to load the party list; locked callers already
  // know their party and skip a 200-row fetch.
  useEffect(() => {
    if (lockPartyId) return;
    apiClientList<Party>('/v1/parties?page_size=200&is_active=true')
      .then((res) => setParties(res.data))
      .catch(() => {});
  }, [lockPartyId]);

  const fetchInvoices = useCallback(async (pid: string) => {
    if (!pid) {
      setInvoices([]);
      return;
    }
    try {
      const res = await apiClientList<AllocationInvoiceOption>(
        `/v1/invoices?party_id=${pid}&status=FINALIZED&page_size=100`,
      );
      setInvoices(res.data.filter((i) => i.balance_due_pkr > 0));
    } catch {
      setInvoices([]);
    }
  }, []);

  useEffect(() => {
    fetchInvoices(partyId);
  }, [partyId, fetchInvoices]);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, hint: p.party_type })),
    [parties],
  );

  const totalAllocated = allocations.reduce(
    (s, a) => s + (parseFloat(a.allocated_amount_pkr) || 0),
    0,
  );

  const allocationColumns = useMemo(
    () => buildAllocationColumns(allocations, invoices),
    [allocations, invoices],
  );

  // Greedily settles oldest invoices first — the collections-desk default for
  // "just apply this payment", leaving the operator to adjust for exceptions.
  const autoAllocateOldestFirst = () => {
    const total = parseFloat(amountPkr) || 0;
    if (total <= 0 || invoices.length === 0) return;
    const sorted = [...invoices].sort((a, b) => a.invoice_date.localeCompare(b.invoice_date));
    const rows: AllocationRow[] = [];
    let remaining = total;
    for (const inv of sorted) {
      if (remaining <= 0.001) break;
      const take = Math.min(remaining, inv.balance_due_pkr);
      if (take <= 0) continue;
      rows.push({ invoice_id: inv.id, allocated_amount_pkr: take.toFixed(2) });
      remaining -= take;
    }
    setAllocations(rows);
  };

  const record = useApiMutation<{ id: string }, void>({
    mutationFn: () => {
      const validAllocations = isAdvance
        ? []
        : allocations
            .filter((a) => a.invoice_id && parseFloat(a.allocated_amount_pkr) > 0)
            .map((a) => ({
              invoice_id: a.invoice_id,
              allocated_amount_pkr: parseFloat(a.allocated_amount_pkr),
            }));
      return apiClient<{ id: string }>('/v1/payments', {
        method: 'POST',
        body: {
          party_id: partyId,
          payment_date: paymentDate,
          amount_pkr: parseFloat(amountPkr),
          payment_method: paymentMethod,
          reference_number: referenceNumber || undefined,
          ...(Number(taxWithheld) > 0 ? { tax_withheld_pkr: Number(taxWithheld) } : {}),
          is_advance: isAdvance,
          cheque_date: paymentMethod === 'CHEQUE' && chequeDate ? chequeDate : undefined,
          notes: notes || undefined,
          allocations: validAllocations,
        },
      });
    },
    invalidates: [
      qk.payments.all,
      qk.invoices.all,
      ...(partyId ? [qk.parties.ledger(partyId), qk.parties.detail(partyId)] : []),
    ],
    successMessage: 'Payment recorded',
    onSuccess: (data) => onCreated(data),
    onError: (err) => {
      submittingRef.current = false;
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    if (!partyId) return setError('Please select a party.');
    if (!amountPkr || parseFloat(amountPkr) <= 0) return setError('Amount must be positive.');
    submittingRef.current = true;
    setError('');
    record.mutate();
  };

  const fields = (
    <>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <EntrySheet>
        <EntryGroup title="Payment" columns={columns}>
          <div className="space-y-1 xl:col-span-2">
            <Label>
              Party <span className="text-destructive">*</span>
            </Label>
            {lockPartyId ? (
              <p className="flex h-8 items-center text-sm font-medium">{partyName ?? '—'}</p>
            ) : (
              <Combobox
                options={partyOptions}
                value={partyId}
                onChange={(v) => {
                  setPartyId(v);
                  setAllocations([]);
                }}
                placeholder="Select party…"
                searchPlaceholder="Search parties…"
                testId="combobox-party_id"
                className="h-8"
              />
            )}
          </div>
          <div className="space-y-1">
            <Label>
              Payment date <span className="text-destructive">*</span>
            </Label>
            <Input
              type="date"
              name="payment_date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="tabular-nums"
              required
            />
          </div>
          <div className="space-y-1">
            <Label>
              Amount (PKR) <span className="text-destructive">*</span>
            </Label>
            <Input
              type="number"
              name="amount_pkr"
              min={0.01}
              step={0.01}
              value={amountPkr}
              onChange={(e) => setAmountPkr(e.target.value)}
              placeholder="0.00"
              className="tabular-nums"
              required
            />
          </div>
          <div className="space-y-1">
            <Label>
              Payment method <span className="text-destructive">*</span>
            </Label>
            <select
              name="payment_method"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="CASH">Cash</option>
              <option value="CHEQUE">Cheque</option>
              <option value="BANK_TRANSFER">Bank Transfer</option>
              <option value="MOBILE_WALLET">Mobile Wallet</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Reference number</Label>
            <Input
              name="reference_number"
              value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="Cheque #, transfer ref…"
            />
          </div>
          {!isAdvance && (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <Label>Tax withheld (optional)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground" aria-label="What is tax withheld at source?" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Enter the amount above as what settles the invoice, before any deduction. The
                    deduction is an advance of your own income tax, held in 1240 — not a discount
                    and not a shortfall.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                name="tax_withheld_pkr"
                type="number"
                min={0}
                step={0.01}
                value={taxWithheld}
                onChange={(e) => setTaxWithheld(e.target.value)}
                placeholder="0.00"
              />
              {Number(taxWithheld) > 0 && Number(amountPkr) > 0 && (
                <p className="text-xs text-muted-foreground">
                  Settles in full at {formatMoney(Number(amountPkr))}; cash received is{' '}
                  {formatMoney(Number(amountPkr) - Number(taxWithheld))}.
                </p>
              )}
            </div>
          )}
          {paymentMethod === 'CHEQUE' && (
            <div className="space-y-1">
              <Label>Cheque date</Label>
              <Input
                type="date"
                name="cheque_date"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
                className="tabular-nums"
              />
            </div>
          )}
          {/* An invoice-context payment is by definition not an advance. */}
          {!defaultInvoiceId && (
            <label className="flex h-8 items-center gap-2 text-sm">
              <Checkbox
                checked={isAdvance}
                onCheckedChange={(c) => {
                  setIsAdvance(!!c);
                  setAllocations([]);
                }}
              />
              Advance payment
            </label>
          )}
          <div className="space-y-1 xl:col-span-3">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                autoGrow(e.currentTarget);
              }}
              rows={1}
              className="min-h-[32px] resize-none"
            />
          </div>
        </EntryGroup>

        {!isAdvance && (
          <EntryGroup title="Invoice allocations" columns={2}>
            <div className="col-span-full space-y-2">
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={autoAllocateOldestFirst}
                  disabled={!partyId || invoices.length === 0 || !amountPkr}
                >
                  Auto-allocate oldest first
                </Button>
                {partyId && invoices.length === 0 && (
                  <p className="text-sm italic text-muted-foreground">
                    No finalized invoices with outstanding balance for this party.
                  </p>
                )}
              </div>

              <EditableRows
                rows={allocations}
                onChange={setAllocations}
                columns={allocationColumns}
                newRow={newAllocationRow}
                addLabel="Add Invoice"
                disabled={!partyId || invoices.length === 0}
              />
            </div>
          </EntryGroup>
        )}
      </EntrySheet>
    </>
  );

  const actions = (
    <FormActions
      meta={
        allocations.length > 0 ? (
          <EntryChip
            label="Allocated"
            value={`${formatMoney(totalAllocated)}${amountPkr ? ` / ${formatMoney(parseFloat(amountPkr))}` : ''}`}
            tone={
              amountPkr && totalAllocated > parseFloat(amountPkr) ? 'destructive' : 'default'
            }
          />
        ) : undefined
      }
    >
      <Button type="submit" disabled={record.isPending}>
        {record.isPending ? 'Recording…' : 'Record Payment'}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </FormActions>
  );

  if (variant === 'sheet') {
    return (
      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-4">
        {/* The only scroll container in the drawer: the allocations table stays
            reachable and the submit row never scrolls out of reach. */}
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
