'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { EditableRowColumn } from '@/components/form';
import { formatMoney } from '@/lib/format';

export interface AllocationInvoiceOption {
  id: string;
  invoice_number: string | null;
  balance_due_pkr: number;
  /** Drives "auto-allocate oldest first"; always present on the invoice list row. */
  invoice_date: string;
}

export interface AllocationRow {
  invoice_id: string;
  allocated_amount_pkr: string;
}

export const newAllocationRow = (): AllocationRow => ({ invoice_id: '', allocated_amount_pkr: '' });

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Shared invoice-allocation columns for EditableRows — used by payment
 * creation, the payment detail Apply Advance panel, and the Record Payment
 * dialog. Built fresh per render (not a module constant): each row's
 * <select> needs the current `rows` to exclude invoices a sibling row
 * already claimed, which only the caller has in scope.
 */
export function buildAllocationColumns(
  rows: AllocationRow[],
  invoices: AllocationInvoiceOption[],
): EditableRowColumn<AllocationRow>[] {
  return [
    {
      key: 'invoice',
      header: 'Invoice',
      width: '2fr',
      render: (row, update, index) => {
        const chosenElsewhere = new Set(
          rows.filter((_, i) => i !== index).map((r) => r.invoice_id).filter(Boolean),
        );
        const options = invoices.filter((inv) => inv.id === row.invoice_id || !chosenElsewhere.has(inv.id));
        return (
          <select
            name="allocation_invoice"
            value={row.invoice_id}
            onChange={(e) => update({ invoice_id: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">Select invoice…</option>
            {options.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoice_number ?? 'Draft'} — Balance: {formatMoney(inv.balance_due_pkr)}
              </option>
            ))}
          </select>
        );
      },
    },
    {
      key: 'amount',
      header: 'Amount (PKR)',
      width: '220px',
      align: 'right',
      render: (row, update) => {
        const inv = invoices.find((i) => i.id === row.invoice_id);
        return (
          <div className="flex items-center gap-1">
            <Input
              type="number"
              name="allocation_amount"
              min={0.01}
              step={0.01}
              value={row.allocated_amount_pkr}
              onChange={(e) => update({ allocated_amount_pkr: e.target.value })}
              placeholder="0.00"
              className="h-8 text-right tabular-nums"
            />
            {inv && (
              <Button
                type="button"
                variant="link"
                className="h-8 shrink-0 px-1 text-xs"
                onClick={() => update({ allocated_amount_pkr: String(inv.balance_due_pkr) })}
              >
                Fill
              </Button>
            )}
          </div>
        );
      },
    },
  ];
}
