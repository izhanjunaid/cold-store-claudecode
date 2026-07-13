'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Banknote, FileText } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

import { formatDate, formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface Repayment {
  id: string;
  repayment_date: string;
  amount_pkr: number;
  payment_method: string;
  asset_account_code: string | null;
  journal_entry_id: string | null;
}
interface Loan {
  id: string;
  loan_number: string;
  party_name?: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
  source_asset_account_code: string;
  issue_journal_entry_id: string | null;
  write_off_journal_entry_id: string | null;
  write_off_reason: string | null;
  write_off_at: string | null;
  repayments?: Repayment[];
}

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

export default function LoanDetailPage() {
  const router = useRouter();
  const params = useParams();
  const loanId = params['id'] as string;
  const { user } = useAuthStore();

  const isOwner = can(user, 'loans.issue');
  const canRepay = can(user, 'loans.record_repayment');
  const canView = can(user, 'loans.view');

  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [repayModal, setRepayModal] = useState(false);
  const [repayDate, setRepayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [repayLoading, setRepayLoading] = useState(false);

  const [writeOffModal, setWriteOffModal] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffLoading, setWriteOffLoading] = useState(false);

  const fetchLoan = useCallback(async () => {
    setLoading(true);
    try {
      setLoan(await apiClient<Loan>(`/v1/loans/${loanId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan');
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    fetchLoan();
  }, [fetchLoan]);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Loan" />
        <p className="text-muted-foreground">You don&apos;t have permission to view this loan.</p>
      </div>
    );
  }
  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!loan) return <p className="text-muted-foreground">Loan not found</p>;

  async function submitRepayment() {
    setRepayLoading(true);
    try {
      const amt = Number(repayAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Enter a valid amount');
      await apiClient(`/v1/loans/${loanId}/repayments`, {
        method: 'POST',
        body: {
          repayment_date: repayDate,
          amount_pkr: amt,
          payment_method: repayMethod,
          asset_account_code: repayMethod === 'CASH' ? '1010' : '1020',
        },
      });
      setRepayModal(false);
      setRepayAmount('');
      toast.success('Repayment recorded');
      await fetchLoan();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Repayment failed');
    } finally {
      setRepayLoading(false);
    }
  }

  async function submitWriteOff() {
    setWriteOffLoading(true);
    try {
      if (writeOffReason.trim().length < 3) throw new Error('Reason must be at least 3 characters');
      await apiClient(`/v1/loans/${loanId}/write-off`, { method: 'POST', body: { reason: writeOffReason.trim() } });
      setWriteOffModal(false);
      setWriteOffReason('');
      toast.success('Loan written off');
      await fetchLoan();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Write-off failed');
    } finally {
      setWriteOffLoading(false);
    }
  }

  async function downloadAck() {
    const token = localStorage.getItem('access_token');
    const facilityId = localStorage.getItem('facility_id');
    const res = await fetch(`${API_URL}/v1/loans/${loanId}/acknowledgment?format=pdf`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Facility-ID': facilityId ?? '' },
    });
    if (!res.ok) return toast.error(`Download failed (${res.status})`);
    window.open(URL.createObjectURL(await res.blob()), '_blank');
  }

  return (
    <div>
      <PageHeader
        title={loan.loan_number}
        crumb={loan.loan_number}
        description={`${loan.party_name ?? '—'} · Issued ${formatDate(loan.issue_date)}`}
        actions={
          <>
            <Button variant="outline" onClick={downloadAck}>
              <FileText className="h-4 w-4" aria-hidden />
              Download Acknowledgment
            </Button>
            {loan.status === 'ACTIVE' && canRepay && (
              <Button onClick={() => setRepayModal(true)}>
                <Banknote className="h-4 w-4" aria-hidden />
                Record Repayment
              </Button>
            )}
            {loan.status === 'ACTIVE' && isOwner && (
              <Button variant="outline" className="text-destructive" onClick={() => setWriteOffModal(true)}>
                Write Off
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-1"><StatusBadge status={loan.status} /></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Principal</div>
            <div className="text-xl font-bold tabular-nums">{formatMoney(Number(loan.principal_pkr))}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance Outstanding</div>
            <div className={cn('text-xl font-bold tabular-nums', loan.balance_outstanding_pkr > 0 ? 'text-green-700' : 'text-muted-foreground')}>
              {formatMoney(Number(loan.balance_outstanding_pkr))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Source Account</div>
            <div className="font-mono">{loan.source_asset_account_code}</div>
          </div>
        </CardContent>
        {loan.status === 'WRITTEN_OFF' && loan.write_off_reason && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <strong>Write-off reason:</strong> {loan.write_off_reason}
              {loan.write_off_at && <span className="ml-2">on {formatDate(loan.write_off_at)}</span>}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Repayment History</CardTitle></CardHeader>
        <CardContent>
          {loan.repayments && loan.repayments.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>JE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.repayments.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.repayment_date)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{Number(r.amount_pkr).toLocaleString()}</TableCell>
                    <TableCell>{r.payment_method.replace(/_/g, ' ')}</TableCell>
                    <TableCell className="font-mono">{r.asset_account_code ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.journal_entry_id ? r.journal_entry_id.slice(0, 8) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No repayments recorded.</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={repayModal} onOpenChange={setRepayModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Repayment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={repayDate} onChange={(e) => setRepayDate(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (PKR)</Label>
              <Input type="number" step={0.01} value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)} className="tabular-nums" />
              <p className="text-xs text-muted-foreground">Outstanding: {formatMoney(Number(loan.balance_outstanding_pkr))}</p>
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <div className="flex gap-2">
                {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                  <Button key={m} type="button" variant={repayMethod === m ? 'default' : 'outline'} size="sm" onClick={() => setRepayMethod(m)}>
                    {m === 'CASH' ? 'Cash' : 'Bank'}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepayModal(false)}>Cancel</Button>
            <Button onClick={submitRepayment} disabled={repayLoading}>{repayLoading ? 'Saving…' : 'Record Repayment'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={writeOffModal} onOpenChange={setWriteOffModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Write Off Loan</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This posts JE-20 (DR 6080 Bad Debt / CR 1140 Peshgi AR) for the outstanding balance and marks the loan
            WRITTEN_OFF. This cannot be undone.
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea value={writeOffReason} onChange={(e) => setWriteOffReason(e.target.value)} rows={3} placeholder="Bad debt — farmer relocated, unable to recover" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffModal(false)}>Cancel</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={submitWriteOff} disabled={writeOffLoading}>
              {writeOffLoading ? 'Writing off…' : 'Write Off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
