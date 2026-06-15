'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface ExpenseVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  payment_date: string | null;
  expense_account_code: string;
  description: string;
  vendor_name: string | null;
  reference_number: string | null;
  amount_pkr: number;
  payment_method: string | null;
  is_accrual: boolean;
  status: 'DRAFT' | 'APPROVED' | 'ACCRUED' | 'PAID' | 'CANCELLED';
  accrual_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
}

export default function ExpenseVoucherDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const confirm = useConfirm();
  const isManager = hasMinRole(user?.role, 'MANAGER');
  const isAccountant = hasMinRole(user?.role, 'ACCOUNTANT');

  const [v, setV] = useState<ExpenseVoucher | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CHEQUE' | 'BANK_TRANSFER'>('BANK_TRANSFER');
  const [assetAccount, setAssetAccount] = useState('1020');

  const fetchV = useCallback(async () => {
    setLoading(true);
    try {
      setV(await apiClient<ExpenseVoucher>(`/v1/expense-vouchers/${id}`));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchV();
  }, [fetchV]);

  async function action(path: string, body?: unknown, successMsg?: string) {
    try {
      await apiClient(`/v1/expense-vouchers/${id}/${path}`, { method: 'POST', body: body ?? {} });
      if (successMsg) toast.success(successMsg);
      fetchV();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
      return false;
    }
  }

  async function pay() {
    if (await action('pay', { payment_date: paymentDate, payment_method: paymentMethod, asset_account_code: assetAccount }, 'Voucher paid')) {
      setShowPay(false);
    }
  }

  async function cancel() {
    if (await confirm({ title: 'Cancel this voucher?', confirmText: 'Cancel Voucher', destructive: true })) {
      action('cancel', { reason: 'Cancelled from UI' }, 'Voucher cancelled');
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!v) return <p className="text-destructive">Voucher not found</p>;

  return (
    <div>
      <PageHeader
        title={v.description}
        crumb={v.voucher_number}
        description={`${v.voucher_date} · Account ${v.expense_account_code}${v.vendor_name ? ` · ${v.vendor_name}` : ''}${v.reference_number ? ` · Ref ${v.reference_number}` : ''}`}
        actions={
          <>
            {isManager && v.status === 'DRAFT' && <Button onClick={() => action('approve', {}, 'Approved')}>Approve</Button>}
            {isAccountant && v.status === 'APPROVED' && v.is_accrual && <Button onClick={() => action('accrue', {}, 'Accrued')}>Accrue (JE-17B)</Button>}
            {isAccountant && (v.status === 'APPROVED' || v.status === 'ACCRUED') && (
              <Button onClick={() => setShowPay(true)}>Pay ({v.status === 'ACCRUED' ? 'JE-17B-PAY' : 'JE-17A'})</Button>
            )}
            {isManager && (v.status === 'DRAFT' || v.status === 'APPROVED') && (
              <Button variant="outline" className="text-destructive" onClick={cancel}>Cancel</Button>
            )}
          </>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{v.voucher_number}</span>
            <StatusBadge status={v.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Amount</div><div className="text-lg font-semibold tabular-nums">Rs. {v.amount_pkr.toLocaleString()}</div></div>
            {v.payment_date && <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Paid On</div><div>{v.payment_date} ({v.payment_method})</div></div>}
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Type</div><div>{v.is_accrual ? 'Accrual' : 'Direct'}</div></div>
          </div>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            {v.accrual_journal_entry_id && <div>Accrual JE-17B: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${v.accrual_journal_entry_id}`)}>{v.accrual_journal_entry_id.slice(0, 8)}…</Button></div>}
            {v.payment_journal_entry_id && <div>Payment JE: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${v.payment_journal_entry_id}`)}>{v.payment_journal_entry_id.slice(0, 8)}…</Button></div>}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showPay} onOpenChange={setShowPay}>
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
                  setAssetAccount(m === 'CASH' ? '1010' : '1020');
                }}
                className={SELECT_CLASS}
              >
                <option value="CASH">Cash (1010)</option>
                <option value="CHEQUE">Cheque (1020)</option>
                <option value="BANK_TRANSFER">Bank Transfer (1020)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Asset Account</Label>
              <select value={assetAccount} onChange={(e) => setAssetAccount(e.target.value)} className={SELECT_CLASS}>
                <option value="1010">1010 — Cash on Hand</option>
                <option value="1020">1020 — Bank Account — Main</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>
            <Button onClick={pay}>Pay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
