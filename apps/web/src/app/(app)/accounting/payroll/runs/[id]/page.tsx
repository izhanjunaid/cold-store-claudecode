'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

import { formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface LineItem {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  days_worked: number | null;
  gross_pay_pkr: number;
  eobi_employee_pkr: number;
  eobi_employer_pkr: number;
  income_tax_pkr: number;
  other_deductions_pkr: number;
  net_pay_pkr: number;
}

interface PayrollRun {
  id: string;
  run_number: string;
  payroll_type: 'MONTHLY_SALARY' | 'DAILY_WAGES';
  period_year: number;
  period_month: number;
  period_from: string;
  period_to: string;
  total_gross_pkr: number;
  total_employer_eobi_pkr: number;
  total_deductions_pkr: number;
  total_net_payable_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'PAID';
  payroll_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  remittance_journal_entry_id: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  notes: string | null;
  line_items: LineItem[];
}

export default function PayrollRunDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isManager = can(user, 'payroll.finalize');
  const isOwner = can(user, 'payroll.remit');
  const isAccountant = can(user, 'payroll.view');

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [remitDate, setRemitDate] = useState(new Date().toISOString().slice(0, 10));

  const fetchRun = useCallback(async () => {
    setLoading(true);
    try {
      setRun(await apiClient<PayrollRun>(`/v1/payroll-runs/${id}`));
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  async function finalize() {
    try {
      await apiClient(`/v1/payroll-runs/${id}/finalize`, { method: 'POST', body: {} });
      toast.success('Payroll finalized');
      fetchRun();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Finalize failed'); }
  }

  async function pay() {
    try {
      await apiClient(`/v1/payroll-runs/${id}/pay`, {
        method: 'POST',
        body: { payment_date: paymentDate, from_asset_account_code: '1020' },
      });
      setShowPay(false);
      toast.success('Salaries paid');
      fetchRun();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Payment failed'); }
  }

  async function remit() {
    if (!run) return;
    try {
      await apiClient(`/v1/payroll-runs/${id}/remit`, {
        method: 'POST',
        body: {
          remittance_date: remitDate,
          from_asset_account_code: '1020',
          remit_employee_eobi_pkr: run.line_items.reduce((s, l) => s + l.eobi_employee_pkr, 0),
          remit_employer_eobi_pkr: run.total_employer_eobi_pkr,
          remit_income_tax_pkr: run.line_items.reduce((s, l) => s + l.income_tax_pkr, 0),
        },
      });
      setShowRemit(false);
      toast.success('EOBI / tax remitted');
      fetchRun();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Remittance failed'); }
  }

  async function viewSlip(lineId: string) {
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';
      const res = await fetch(
        `${apiUrl}/v1/payroll-runs/${id}/lines/${lineId}/slip?format=pdf`,
        { headers: { Authorization: `Bearer ${token}`, 'X-Facility-ID': facilityId ?? '' } },
      );
      if (!res.ok) throw new Error(`PDF download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Slip download failed'); }
  }

  if (loading) return <PageSkeleton />;
  if (!run) return <p className="text-destructive">Run not found</p>;

  return (
    <div>
      <PageHeader
        title={`Payroll ${run.period_year}-${String(run.period_month).padStart(2, '0')} (${run.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'})`}
        crumb={run.run_number}
        description={`${run.period_from} → ${run.period_to}`}
        actions={
          <>
            {isManager && run.status === 'DRAFT' && (
              <Button onClick={finalize}>Finalize (post JE-15{run.payroll_type === 'DAILY_WAGES' ? 'B' : ''})</Button>
            )}
            {isManager && run.status === 'FINALIZED' && <Button onClick={() => setShowPay(true)}>Pay (post JE-16)</Button>}
            {isOwner && run.status !== 'DRAFT' && !run.remittance_journal_entry_id && (
              <Button variant="outline" onClick={() => setShowRemit(true)}>Remit EOBI/Tax (JE-16B)</Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{run.run_number}</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Total Gross</div><div className="text-lg font-semibold tabular-nums">{formatMoney(run.total_gross_pkr)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Deductions</div><div className="text-lg font-semibold tabular-nums text-amber-600">{formatMoney(run.total_deductions_pkr)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Employer EOBI</div><div className="text-lg font-semibold tabular-nums">{formatMoney(run.total_employer_eobi_pkr)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Net Payable</div><div className="text-lg font-semibold tabular-nums text-green-700">{formatMoney(run.total_net_payable_pkr)}</div></div>
          </div>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            {run.payroll_journal_entry_id && <div>Payroll JE: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${run.payroll_journal_entry_id}`)}>{run.payroll_journal_entry_id.slice(0, 8)}…</Button></div>}
            {run.payment_journal_entry_id && <div>Payment JE-16: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${run.payment_journal_entry_id}`)}>{run.payment_journal_entry_id.slice(0, 8)}…</Button></div>}
            {run.remittance_journal_entry_id && <div>Remittance JE-16B: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${run.remittance_journal_entry_id}`)}>{run.remittance_journal_entry_id.slice(0, 8)}…</Button></div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-3 text-sm font-semibold">Line Items ({run.line_items.length} employees)</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">EOBI (E)</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.line_items.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.employee_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.days_worked ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.gross_pay_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-600">{l.eobi_employee_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.income_tax_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.other_deductions_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-green-700">{l.net_pay_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    {isAccountant && <Button variant="link" className="h-auto p-0" onClick={() => viewSlip(l.id)}>Slip</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showPay} onOpenChange={setShowPay}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay Salaries</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Posts JE-16: DR 2030 {formatMoney(run.total_net_payable_pkr)} / CR 1020.</p>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="tabular-nums" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>
            <Button onClick={pay}>Pay</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRemit} onOpenChange={setShowRemit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remit EOBI / Tax</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Posts JE-16B clearing 2060/2061/2070 against 1020.</p>
          <div className="space-y-1.5">
            <Label>Remittance Date</Label>
            <Input type="date" value={remitDate} onChange={(e) => setRemitDate(e.target.value)} className="tabular-nums" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemit(false)}>Cancel</Button>
            <Button onClick={remit}>Remit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
