'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const EXPENSE_ACCOUNTS = [
  { code: '5010', name: 'Electricity — Refrigeration' },
  { code: '5020', name: 'Electricity — Facility (Non-Refrig.)' },
  { code: '5050', name: 'Refrigerant & Consumables' },
  { code: '5060', name: 'Packaging & Materials' },
  { code: '6020', name: 'Rent' },
  { code: '6030', name: 'Maintenance & Repairs' },
  { code: '6040', name: 'Fuel & Vehicle' },
  { code: '6050', name: 'Insurance' },
  { code: '6060', name: 'Communication' },
  { code: '6070', name: 'Computer & Software' },
  { code: '6090', name: 'Bank Charges' },
  { code: '6100', name: 'Miscellaneous' },
];

export default function NewExpenseVoucherPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = hasMinRole(user?.role, 'ACCOUNTANT');

  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountCode, setAccountCode] = useState('5010');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [isAccrual, setIsAccrual] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous guard: `submitting` state only disables the button on the next
  // render, leaving a window where rapid clicks fire multiple POSTs (duplicate
  // drafts) and a burst of navigations that crashes the dev render worker.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="New Expense Voucher" />
        <p className="text-muted-foreground">Requires ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiClient<{ id: string }>('/v1/expense-vouchers', {
        method: 'POST',
        body: {
          voucher_date: voucherDate,
          expense_account_code: accountCode,
          description,
          vendor_name: vendor || null,
          reference_number: refNumber || null,
          amount_pkr: Number(amount),
          is_accrual: isAccrual,
        },
      });
      toast.success('Draft voucher created');
      router.push(`/accounting/expenses/${created.id}`);
      // Stay disabled through the (slow, dev-mode) navigation — resetting here
      // would re-open the duplicate-submit window before the route transitions.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create voucher');
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New Expense Voucher" crumb="New" />
      <form onSubmit={handleSubmit} className="space-y-4">
        <EntrySheet>
          <EntryGroup title="Voucher" columns={2}>
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Voucher starts as DRAFT. After creation: Approve (MANAGER+) → Pay (JE-17A) or Accrue (JE-17B) then Pay later.
            </p>
            <div className="space-y-1.5">
              <Label>Voucher date <span className="text-destructive">*</span></Label>
              <Input type="date" required value={voucherDate} onChange={(e) => setVoucherDate(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Expense account <span className="text-destructive">*</span></Label>
              <select value={accountCode} onChange={(e) => setAccountCode(e.target.value)} className={SELECT_CLASS}>
                {EXPENSE_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description <span className="text-destructive">*</span></Label>
              <Input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. LESCO refrigeration bill — April 2026" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. LESCO" />
              </div>
              <div className="space-y-1.5">
                <Label>Reference / Bill #</Label>
                <Input value={refNumber} onChange={(e) => setRefNumber(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Amount (PKR) <span className="text-destructive">*</span></Label>
                <Input type="number" required min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
              </div>
            </div>
            <div className="rounded-md border p-3 sm:col-span-2">
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={isAccrual} onCheckedChange={(c) => setIsAccrual(!!c)} />
                This is an accrual (bill received, payment scheduled later)
              </label>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                If checked, after approval you accrue (JE-17B), then pay later (JE-17B-PAY).
              </p>
            </div>
          </EntryGroup>
        </EntrySheet>

        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

        <FormActions>
          <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Draft'}</Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </FormActions>
      </form>
    </div>
  );
}
