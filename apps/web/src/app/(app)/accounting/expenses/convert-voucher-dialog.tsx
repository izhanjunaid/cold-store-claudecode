'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/format';
import { SELECT_CLASS, useSuppliers } from '../payables/payables-shared';

export interface LegacyVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  reference_number: string | null;
  amount_pkr: number;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED' | 'CONVERTED';
  accrual_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  bill_id: string | null;
  allowed_actions: Array<'cancel' | 'convert_to_bill'>;
}

/**
 * Move an accrued voucher's liability onto a supplier as a bill. The cost was booked
 * when the voucher was accrued, so nothing is expensed again.
 */
export function ConvertVoucherDialog({
  voucher,
  onOpenChange,
  onConverted,
}: {
  voucher: LegacyVoucher | null;
  onOpenChange: (open: boolean) => void;
  onConverted: (billId: string) => void;
}) {
  const { data: suppliers = [] } = useSuppliers();
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(() => localIsoDate());
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!voucher) return;
    setBusy(true);
    try {
      const converted = await apiClient<LegacyVoucher>(`/v1/expense-vouchers/${voucher.id}/convert-to-bill`, {
        method: 'POST',
        body: { supplier_party_id: supplierId, conversion_date: date, ...(dueDate ? { due_date: dueDate } : {}) },
      });
      toast.success(`${voucher.voucher_number} is now a bill`);
      onOpenChange(false);
      if (converted.bill_id) onConverted(converted.bill_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert the voucher');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={voucher !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert {voucher?.voucher_number} to a bill</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {voucher && `${formatMoney(voucher.amount_pkr)} owed${voucher.vendor_name ? ` to ${voucher.vendor_name}` : ''}.`} The
          amount moves onto the supplier&apos;s account, where it is paid and aged like any bill.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="cv-supplier">Supplier</Label>
          <select id="cv-supplier" className={SELECT_CLASS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Choose a supplier…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {suppliers.length === 0 && (
            <p className="text-xs text-muted-foreground">Add the supplier under Parties (type: Supplier) first.</p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cv-date">Convert on</Label>
            <Input id="cv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cv-due">Due date</Label>
            <Input id="cv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !supplierId} onClick={submit}>Convert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Cancel a voucher that posted nothing. */
export async function cancelVoucher(voucher: LegacyVoucher, onDone: () => void) {
  try {
    await apiClient(`/v1/expense-vouchers/${voucher.id}/cancel`, { method: 'POST', body: {} });
    toast.success(`${voucher.voucher_number} cancelled`);
    onDone();
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not cancel the voucher');
  }
}
