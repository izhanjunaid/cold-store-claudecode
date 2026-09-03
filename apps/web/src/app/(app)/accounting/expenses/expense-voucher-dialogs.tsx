'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { assetAccountForPaymentMethod, DEFAULT_BANK_ACCOUNT_CODE } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAccounts, isCashOrBank, isExpenseAccount } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/format';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

/**
 * Edit + Pay dialogs, shared between the expense list's row actions and the
 * detail page — one implementation instead of two copies drifting apart.
 * Each takes the target voucher as a prop and resyncs its fields whenever
 * that prop changes (a fresh voucher selected, or a refetch after save),
 * the same pattern payroll's NumCell uses for external-value resync.
 */

export interface EditableVoucher {
  id: string;
  voucher_date: string;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  reference_number: string | null;
  amount_pkr: number;
}

export function ExpenseVoucherEditDialog({
  voucher, open, onOpenChange, onSaved,
}: {
  voucher: EditableVoucher | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const expenseAccounts = accounts.filter(isExpenseAccount);

  const [date, setDate] = useState('');
  const [account, setAccount] = useState('');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!voucher) return;
    setDate(voucher.voucher_date);
    setAccount(voucher.expense_account_code);
    setDescription(voucher.description);
    setVendor(voucher.vendor_name ?? '');
    setRef(voucher.reference_number ?? '');
    setAmount(String(voucher.amount_pkr));
  }, [voucher]);

  async function save() {
    if (!voucher) return;
    setSaving(true);
    try {
      await apiClient(`/v1/expense-vouchers/${voucher.id}`, {
        method: 'PATCH',
        body: {
          voucher_date: date,
          expense_account_code: account,
          description,
          vendor_name: vendor || null,
          reference_number: ref || null,
          amount_pkr: Number(amount),
        },
      });
      toast.success('Voucher updated');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Voucher</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Only the DRAFT voucher's own fields — payment details are set separately when it's paid.</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Voucher date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Expense account</Label>
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={SELECT_CLASS}>
              {expenseAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Reference / Bill #</Label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Amount (PKR)</Label>
            <Input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PayableVoucher {
  id: string;
  amount_pkr: number;
}

export function ExpenseVoucherPayDialog({
  voucher, open, onOpenChange, onPaid,
}: {
  voucher: PayableVoucher | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CHEQUE' | 'BANK_TRANSFER'>('BANK_TRANSFER');
  // Default stays 1020 (bank) so an untouched dialog pays exactly as it did
  // before this picker read the live chart.
  const [assetAccount, setAssetAccount] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  const [taxWithheld, setTaxWithheld] = useState('');
  const [withholdingSection, setWithholdingSection] = useState<'S153' | 'S155'>('S153');
  const [paying, setPaying] = useState(false);

  async function pay() {
    if (!voucher) return;
    setPaying(true);
    const withheld = Number(taxWithheld) || 0;
    try {
      await apiClient(`/v1/expense-vouchers/${voucher.id}/pay`, {
        method: 'POST',
        body: {
          payment_date: paymentDate,
          payment_method: paymentMethod,
          asset_account_code: assetAccount,
          ...(withheld > 0
            ? { tax_withheld_pkr: withheld, withholding_section: withholdingSection }
            : {}),
        },
      });
      toast.success('Voucher paid');
      setTaxWithheld('');
      onOpenChange(false);
      onPaid();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setPaying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pay Expense Voucher</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Payment Method</Label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                const m = e.target.value as 'CASH' | 'CHEQUE' | 'BANK_TRANSFER';
                setPaymentMethod(m);
                setAssetAccount(assetAccountForPaymentMethod(m));
              }}
              className={SELECT_CLASS}
            >
              <option value="CASH">Cash ({assetAccountForPaymentMethod('CASH')})</option>
              <option value="CHEQUE">Cheque ({assetAccountForPaymentMethod('CHEQUE')})</option>
              <option value="BANK_TRANSFER">
                Bank Transfer ({assetAccountForPaymentMethod('BANK_TRANSFER')})
              </option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Asset Account</Label>
            <select value={assetAccount} onChange={(e) => setAssetAccount(e.target.value)} className={SELECT_CLASS}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Tax Withheld (PKR, optional)</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={taxWithheld}
              onChange={(e) => setTaxWithheld(e.target.value)}
              placeholder="0.00"
              className="tabular-nums"
            />
          </div>
          {Number(taxWithheld) > 0 && (
            <div className="space-y-1.5">
              <Label>Withheld Under</Label>
              <select
                value={withholdingSection}
                onChange={(e) => setWithholdingSection(e.target.value as 'S153' | 'S155')}
                className={SELECT_CLASS}
              >
                <option value="S153">s.153 — goods, services &amp; contracts (2071)</option>
                <option value="S155">s.155 — rent of immovable property (2072)</option>
              </select>
            </div>
          )}
          {voucher && Number(taxWithheld) > 0 && voucher.amount_pkr > 0 && (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              The supplier receives {formatMoney(voucher.amount_pkr - Number(taxWithheld))}; the{' '}
              {formatMoney(Number(taxWithheld))} withheld is held as a liability until it is paid
              over. The expense stays at {formatMoney(voucher.amount_pkr)} — withholding splits how
              the cost is settled, it does not reduce it.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={pay} disabled={paying}>{paying ? 'Paying…' : 'Pay'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
