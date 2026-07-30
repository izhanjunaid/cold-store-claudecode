'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Recovery {
  id: string;
  payroll_run_id: string;
  payroll_run_number?: string;
  recovery_date: string;
  amount_pkr: number;
}
interface Advance {
  id: string;
  advance_number: string;
  employee_id: string;
  employee_name?: string;
  issue_date: string;
  principal_pkr: number;
  monthly_installment_pkr: number;
  balance_outstanding_pkr: number;
  status: 'ACTIVE' | 'RECOVERED' | 'WRITTEN_OFF';
  source_asset_account_code: string;
  issue_journal_entry_id: string | null;
  write_off_journal_entry_id: string | null;
  write_off_reason: string | null;
  write_off_at: string | null;
  notes: string | null;
  recoveries?: Recovery[];
}

export default function EmployeeAdvanceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const advanceId = params['id'] as string;
  const { user } = useAuthStore();

  const canView = can(user, 'employee_advances.view');
  const canWriteOff = can(user, 'employee_advances.write_off');

  const [advance, setAdvance] = useState<Advance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [writeOffModal, setWriteOffModal] = useState(false);
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffLoading, setWriteOffLoading] = useState(false);

  const fetchAdvance = useCallback(async () => {
    setLoading(true);
    try {
      setAdvance(await apiClient<Advance>(`/v1/employee-advances/${advanceId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load advance');
    } finally {
      setLoading(false);
    }
  }, [advanceId]);

  useEffect(() => {
    fetchAdvance();
  }, [fetchAdvance]);

  async function submitWriteOff() {
    setWriteOffLoading(true);
    try {
      if (writeOffReason.trim().length < 3) throw new Error('Reason must be at least 3 characters');
      await apiClient(`/v1/employee-advances/${advanceId}/write-off`, {
        method: 'POST',
        body: { reason: writeOffReason.trim() },
      });
      setWriteOffModal(false);
      setWriteOffReason('');
      toast.success('Advance written off');
      await fetchAdvance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Write-off failed');
    } finally {
      setWriteOffLoading(false);
    }
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="Employee Advance" />
        <p className="text-muted-foreground">You don&apos;t have permission to view employee advances.</p>
      </div>
    );
  }
  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!advance) return <p className="text-muted-foreground">Advance not found</p>;

  const recovered = Number(advance.principal_pkr) - Number(advance.balance_outstanding_pkr);

  return (
    <div>
      <PageHeader
        title={advance.advance_number}
        crumb={advance.advance_number}
        description={`${advance.employee_name ?? '—'} · Issued ${formatDate(advance.issue_date)}`}
        actions={
          advance.status === 'ACTIVE' &&
          canWriteOff && (
            <Button variant="outline" className="text-destructive" onClick={() => setWriteOffModal(true)}>
              Write Off
            </Button>
          )
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-6 pt-6 md:grid-cols-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-1"><StatusBadge status={advance.status} /></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Principal</div>
            <div className="text-xl font-bold tabular-nums">{formatMoney(Number(advance.principal_pkr))}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Instalment / month</div>
            <div className="text-xl font-bold tabular-nums">{formatMoney(Number(advance.monthly_installment_pkr))}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Recovered</div>
            <div className="text-xl font-bold tabular-nums text-muted-foreground">{formatMoney(recovered)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance Outstanding</div>
            <div className={cn('text-xl font-bold tabular-nums', advance.balance_outstanding_pkr > 0 ? 'text-green-700' : 'text-muted-foreground')}>
              {formatMoney(Number(advance.balance_outstanding_pkr))}
            </div>
          </div>
        </CardContent>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Paid from: <span className="font-mono">{advance.source_asset_account_code}</span></span>
            {advance.issue_journal_entry_id && (
              <span>
                Issue JE-22:{' '}
                <Button
                  variant="link"
                  className="h-auto p-0 font-mono"
                  onClick={() => router.push(`/accounting/journal-entries/${advance.issue_journal_entry_id}`)}
                >
                  {advance.issue_journal_entry_id.slice(0, 8)}…
                </Button>
              </span>
            )}
            {advance.write_off_journal_entry_id && (
              <span>
                Write-off JE-23:{' '}
                <Button
                  variant="link"
                  className="h-auto p-0 font-mono"
                  onClick={() => router.push(`/accounting/journal-entries/${advance.write_off_journal_entry_id}`)}
                >
                  {advance.write_off_journal_entry_id.slice(0, 8)}…
                </Button>
              </span>
            )}
          </div>
        </CardContent>
        {advance.status === 'WRITTEN_OFF' && advance.write_off_reason && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <strong>Write-off reason:</strong> {advance.write_off_reason}
              {advance.write_off_at && <span className="ml-2">on {formatDate(advance.write_off_at)}</span>}
            </div>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recovery History</CardTitle></CardHeader>
        <CardContent>
          {advance.recoveries && advance.recoveries.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Recovered via</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {advance.recoveries.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.recovery_date)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(Number(r.amount_pkr))}</TableCell>
                    <TableCell>
                      <Button
                        variant="link"
                        className="h-auto p-0 font-mono"
                        onClick={() => router.push(`/accounting/payroll/runs/${r.payroll_run_id}`)}
                      >
                        {r.payroll_run_number ?? r.payroll_run_id.slice(0, 8)}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recoveries yet. The instalment is deducted automatically when a payroll run covering this employee is
              finalized.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Recovery posts no journal entry of its own — it rides inside the payroll entry (JE-15/JE-15B) as a credit to
            1230 Advances to Employees.
          </p>
        </CardContent>
      </Card>

      <Dialog open={writeOffModal} onOpenChange={setWriteOffModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Write Off Advance</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Posts JE-23 (DR 6080 Bad Debt / CR 1230 Advances to Employees) for the outstanding balance of{' '}
            {formatMoney(Number(advance.balance_outstanding_pkr))} and marks the advance WRITTEN_OFF. This cannot be
            undone.
          </p>
          <div className="space-y-1.5">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              value={writeOffReason}
              onChange={(e) => setWriteOffReason(e.target.value)}
              rows={3}
              placeholder="Employee left with an unrecovered balance"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWriteOffModal(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={submitWriteOff}
              disabled={writeOffLoading}
            >
              {writeOffLoading ? 'Writing off…' : 'Write Off'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
