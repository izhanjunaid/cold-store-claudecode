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

export interface ApplyAdvanceFormProps<T> {
  paymentId: string;
  partyId: string;
  /** The advance amount — the ceiling on what can be applied. */
  amountPkr: number;
  onDone: (updated: T) => void;
  onCancel?: () => void;
}

/**
 * Applies an ADVANCE payment against open invoices. Shared by the payments
 * list (in a drawer) and `/payments/[id]` (inline), so the JE-04 rules live in
 * one place.
 *
 * An advance can only be applied while status is ADVANCE — the one envelope in
 * which the backend posts JE-04 (DR 2010 / CR receivable). Once applied, status
 * flips to ALLOCATED and the caller unmounts this.
 */
export function ApplyAdvanceForm<T>({
  paymentId,
  partyId,
  amountPkr,
  onDone,
  onCancel,
}: ApplyAdvanceFormProps<T>) {
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
    if (totalToApply > amountPkr + 0.001) {
      setError('Total to apply exceeds the advance amount.');
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
      toast.success('Advance applied');
      onDone(updated);
      // Deliberately not resetting the guard: this unmounts once status is no
      // longer ADVANCE, and re-enabling would allow a second application.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply advance');
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
        Applying drains the advance liability (2010) and settles the invoice (JE-04). This can only
        be done once.
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
            {formatMoney(amountPkr)}
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
          {applying ? 'Applying…' : 'Apply Advance'}
        </Button>
      </div>
    </div>
  );
}

interface ApplyAdvanceSheetProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: { id: string; party_id: string; party_name: string; amount_pkr: number } | null;
  onDone: (updated: T) => void;
}

/**
 * The list-row surface for the same form. A drawer rather than a dialog per
 * spec §5 — it carries an allocation editor, not a couple of fields.
 */
export function ApplyAdvanceSheet<T>({
  open,
  onOpenChange,
  payment,
  onDone,
}: ApplyAdvanceSheetProps<T>) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg">
        <SheetHeader>
          <SheetTitle>Apply Advance{payment ? ` — ${payment.party_name}` : ''}</SheetTitle>
        </SheetHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {open && payment && (
            <ApplyAdvanceForm<T>
              key={payment.id}
              paymentId={payment.id}
              partyId={payment.party_id}
              amountPkr={payment.amount_pkr}
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
