'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { apiClient, apiClientList } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { EditableRows } from '@/components/form';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  buildAllocationColumns,
  newAllocationRow,
  type AllocationRow,
  type AllocationInvoiceOption,
} from '@/components/billing/allocation-columns';
import { formatMoney } from '@/lib/format';

export interface AllocatePaymentFormProps<T> {
  paymentId: string;
  partyId: string;
  /** An advance moves out of customer advances as it is applied; a receipt was already credited to the party. */
  isAdvance: boolean;
  /** What is still unapplied — the ceiling on this application. */
  availablePkr: number;
  onDone: (updated: T) => void;
  onCancel?: () => void;
}

/**
 * Applies a receipt's unapplied money — an advance, or a payment received on
 * account — to the party's open invoices. Shared by the payments list (in a
 * drawer) and `/payments/[id]` (inline). It can be used as many times as money
 * is left: every application of an advance posts its own entry (docs/25 R-02, R-13).
 */
export function AllocatePaymentForm<T>({
  paymentId,
  partyId,
  isAdvance,
  availablePkr,
  onDone,
  onCancel,
}: AllocatePaymentFormProps<T>) {
  const [invoices, setInvoices] = useState<AllocationInvoiceOption[]>([]);
  const [rows, setRows] = useState<AllocationRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const applyingRef = useRef(false);

  useEffect(() => {
    apiClientList<AllocationInvoiceOption>(
      `/v1/invoices?party_id=${partyId}&status=FINALIZED&page_size=100`,
    )
      .then((res) => {
        const open = res.data.filter((i) => i.balance_due_pkr > 0);
        setInvoices(open);
        setRows(open.length > 0 ? [newAllocationRow()] : []);
      })
      .catch(() => {});
  }, [partyId]);

  const totalToApply = rows.reduce((s, r) => s + (parseFloat(r.allocated_amount_pkr) || 0), 0);
  const allocationColumns = useMemo(() => buildAllocationColumns(rows, invoices), [rows, invoices]);

  const handleApply = async () => {
    if (applyingRef.current) return;
    const valid = rows
      .filter((r) => r.invoice_id && parseFloat(r.allocated_amount_pkr) > 0)
      .map((r) => ({
        invoice_id: r.invoice_id,
        allocated_amount_pkr: parseFloat(r.allocated_amount_pkr),
      }));
    if (valid.length === 0) {
      setError('Select an invoice and enter an amount to apply.');
      return;
    }
    if (totalToApply > availablePkr + 0.001) {
      setError(`Only ${formatMoney(availablePkr)} is left to apply.`);
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setError('');
    try {
      const updated = await apiClient<T>(`/v1/payments/${paymentId}/allocate`, {
        method: 'POST',
        body: { allocations: valid },
      });
      toast.success(isAdvance ? 'Advance applied' : 'Receipt applied');
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply the receipt');
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  if (invoices.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No finalized invoices with outstanding balance for this party.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {isAdvance
          ? 'Applying moves this much of the advance off the party’s advance balance and settles the invoice.'
          : 'This receipt is already on the party’s account; applying it only marks which invoices it paid.'}
      </p>
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <EditableRows
        rows={rows}
        onChange={setRows}
        columns={allocationColumns}
        newRow={newAllocationRow}
        addLabel="Add Invoice"
        footer={
          <span className="text-sm text-muted-foreground">
            To apply:{' '}
            <span className="font-medium tabular-nums">{formatMoney(totalToApply)}</span> /{' '}
            {formatMoney(availablePkr)}
          </span>
        }
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={handleApply} disabled={applying}>
          {applying ? 'Applying…' : isAdvance ? 'Apply Advance' : 'Apply Receipt'}
        </Button>
      </div>
    </div>
  );
}

interface AllocatePaymentSheetProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: { id: string; party_id: string; party_name: string; is_advance: boolean; unallocated_pkr: number } | null;
  onDone: (updated: T) => void;
}

/** The list-row surface for the same form — a drawer, since it carries an allocation editor. */
export function AllocatePaymentSheet<T>({ open, onOpenChange, payment, onDone }: AllocatePaymentSheetProps<T>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>
            {payment?.is_advance ? 'Apply Advance' : 'Apply Receipt'}
            {payment ? ` — ${payment.party_name}` : ''}
          </SheetTitle>
        </SheetHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {open && payment && (
            <AllocatePaymentForm<T>
              key={payment.id}
              paymentId={payment.id}
              partyId={payment.party_id}
              isAdvance={payment.is_advance}
              availablePkr={payment.unallocated_pkr}
              onDone={(updated) => {
                onOpenChange(false);
                onDone(updated);
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
