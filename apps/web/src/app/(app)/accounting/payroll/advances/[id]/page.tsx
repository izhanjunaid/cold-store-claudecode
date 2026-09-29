'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  SYSTEM_ACCOUNTS,
  localIsoDate,
  type EmployeeAdvanceRecoveryResponseType,
  type EmployeeAdvanceResponseType,
} from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useAccounts } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

type Dialogs =
  | { kind: 'repay' }
  | { kind: 'write_off' }
  | { kind: 'void' }
  | { kind: 'void_repayment'; recovery: EmployeeAdvanceRecoveryResponseType }
  | null;

export default function EmployeeAdvanceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const advanceId = params['id'] as string;
  const { user } = useAuthStore();
  const { data: accounts = [] } = useAccounts();
  // Repayments land in cash or a bank account — whatever the chart flags as such.
  const cashAccounts = accounts.filter((a) => a.is_cash_equivalent);

  const canView = can(user, 'employee_advances.view');
  // The server says which actions the advance allows; the matrix says who may take them.
  const permitted = {
    repay: can(user, 'employee_advances.issue'),
    write_off: can(user, 'employee_advances.write_off'),
    void: can(user, 'employee_advances.write_off'),
  };

  const [advance, setAdvance] = useState<EmployeeAdvanceResponseType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [repayDate, setRepayDate] = useState(() => localIsoDate());
  const [repayAmount, setRepayAmount] = useState('');
  const [repayTo, setRepayTo] = useState<string>(SYSTEM_ACCOUNTS.CASH_ON_HAND);

  const fetchAdvance = useCallback(async () => {
    setLoading(true);
    try {
      setAdvance(await apiClient<EmployeeAdvanceResponseType>(`/v1/employee-advances/${advanceId}`));
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

  function open(next: NonNullable<Dialogs>) {
    setReason('');
    if (next.kind === 'repay') setRepayAmount(String(advance?.balance_outstanding_pkr ?? ''));
    setDialog(next);
  }

  async function act(path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await apiClient(`/v1/employee-advances/${advanceId}/${path}`, { method: 'POST', body });
      setDialog(null);
      toast.success(done);
      await fetchAdvance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
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

  const actions = advance.allowed_actions.filter((a) => permitted[a]);
  const recovered = advance.status === 'VOIDED' ? 0 : advance.principal_pkr - advance.balance_outstanding_pkr;
  const reasonValid = reason.trim().length >= 3;
  const accountName = (code: string | null) =>
    accounts.find((a) => a.account_code === code)?.account_name ?? code ?? '—';

  return (
    <div>
      <PageHeader
        title={advance.advance_number}
        crumb={advance.advance_number}
        description={`${advance.employee_name ?? '—'} · Issued ${formatDate(advance.issue_date)}`}
        actions={
          actions.length > 0 && (
            <div className="flex gap-2">
              {actions.includes('repay') && <Button onClick={() => open({ kind: 'repay' })}>Record Repayment</Button>}
              {actions.includes('write_off') && (
                <Button variant="outline" onClick={() => open({ kind: 'write_off' })}>Write Off</Button>
              )}
              {actions.includes('void') && (
                <Button variant="outline" className="text-destructive" onClick={() => open({ kind: 'void' })}>
                  Void
                </Button>
              )}
            </div>
          )
        }
      />

      <Card className="mb-6">
        <CardContent className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
            <div className="mt-1"><StatusBadge status={advance.status} /></div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Principal</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(advance.principal_pkr)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Instalment / month</div>
            <div className="text-lg font-semibold tabular-nums">{formatMoney(advance.monthly_installment_pkr)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Recovered</div>
            <div className="text-lg font-semibold tabular-nums text-muted-foreground">{formatMoney(recovered)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Balance Outstanding</div>
            <div className={cn('text-lg font-semibold tabular-nums', advance.balance_outstanding_pkr > 0 ? 'text-green-700' : 'text-muted-foreground')}>
              {formatMoney(advance.balance_outstanding_pkr)}
            </div>
          </div>
        </CardContent>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Paid from: {accountName(advance.source_asset_account_code)}</span>
            {advance.issue_journal_entry_id && (
              <JournalLink label="Issue entry" id={advance.issue_journal_entry_id} onOpen={router.push} />
            )}
            {advance.write_off_journal_entry_id && (
              <JournalLink label="Write-off entry" id={advance.write_off_journal_entry_id} onOpen={router.push} />
            )}
          </div>
        </CardContent>
        {advance.status === 'WRITTEN_OFF' && advance.write_off_reason && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <strong>Written off:</strong> {advance.write_off_reason}
              {advance.write_off_at && <span className="ml-2">on {formatDate(advance.write_off_at)}</span>}
            </div>
          </CardContent>
        )}
        {advance.status === 'VOIDED' && (
          <CardContent className="pt-0">
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <strong>Voided:</strong> {advance.void_reason}
              {advance.voided_at && <span className="ml-2">on {formatDate(advance.voided_at)}</span>} — the issue entry
              has been reversed.
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
                <TableRow className="h-8 hover:bg-transparent">
                  <TableHead className="h-8">Date</TableHead>
                  <TableHead className="h-8 text-right">Amount</TableHead>
                  <TableHead className="h-8">Recovered via</TableHead>
                  <TableHead className="h-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {advance.recoveries.map((r) => (
                  <TableRow key={r.id} className="h-7">
                    <TableCell className="py-1">{formatDate(r.recovery_date)}</TableCell>
                    <TableCell className="py-1 text-right font-medium tabular-nums">{formatMoney(r.amount_pkr)}</TableCell>
                    <TableCell className="py-1">
                      {r.kind === 'PAYROLL' && r.payroll_run_id ? (
                        <Button
                          variant="link"
                          className="h-auto p-0 font-mono"
                          onClick={() => router.push(`/accounting/payroll/runs/${r.payroll_run_id}`)}
                        >
                          Payroll {r.payroll_run_number}
                        </Button>
                      ) : (
                        <span>
                          Repaid into {accountName(r.asset_account_code)}
                          {r.journal_entry_id && (
                            <JournalLink label="" id={r.journal_entry_id} onOpen={router.push} />
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-1 text-right">
                      {r.can_void && permitted.void && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive"
                          onClick={() => open({ kind: 'void_repayment', recovery: r })}
                        >
                          Void
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">
              No recoveries yet. The instalment is deducted automatically when a payroll run covering this employee is
              finalized, or the employee can repay in cash.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            A payroll deduction is part of the payroll run&apos;s entry; a cash repayment has an entry of its own.
          </p>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === 'repay' && (
            <>
              <DialogHeader><DialogTitle>Record Repayment</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                Cash the employee hands back. Outstanding: {formatMoney(advance.balance_outstanding_pkr)}.
              </p>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={repayDate} onChange={(e) => setRepayDate(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={repayAmount}
                  onChange={(e) => setRepayAmount(e.target.value)}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Received Into</Label>
                <select value={repayTo} onChange={(e) => setRepayTo(e.target.value)} className={SELECT_CLASS}>
                  {cashAccounts.map((a) => (
                    <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
                  ))}
                </select>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
                <Button
                  disabled={busy || !(Number(repayAmount) > 0)}
                  onClick={() =>
                    act(
                      'repayments',
                      { repayment_date: repayDate, amount_pkr: Number(repayAmount), asset_account_code: repayTo },
                      'Repayment recorded',
                    )
                  }
                >
                  Record
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog && dialog.kind !== 'repay' && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.kind === 'write_off' ? 'Write Off Advance' : dialog.kind === 'void' ? 'Void Advance' : 'Void Repayment'}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {dialog.kind === 'write_off' &&
                  `Forgives the outstanding ${formatMoney(advance.balance_outstanding_pkr)}: it is expensed as a staff benefit and the advance is closed. This cannot be undone.`}
                {dialog.kind === 'void' &&
                  'For an advance issued in error: its issue entry is reversed and the advance is closed. The employee can be given a new one.'}
                {dialog.kind === 'void_repayment' &&
                  `For a repayment recorded in error: its entry is reversed and ${formatMoney(dialog.recovery.amount_pkr)} is owed again.`}
              </p>
              <div className="space-y-1.5">
                <Label>Reason <span className="text-destructive">*</span></Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
                <Button
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={busy || !reasonValid}
                  onClick={() => {
                    const body = { reason: reason.trim() };
                    if (dialog.kind === 'write_off') act('write-off', body, 'Advance written off');
                    else if (dialog.kind === 'void') act('void', body, 'Advance voided');
                    else act(`repayments/${dialog.recovery.id}/void`, body, 'Repayment voided');
                  }}
                >
                  {dialog.kind === 'write_off' ? 'Write Off' : 'Void'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JournalLink({ label, id, onOpen }: { label: string; id: string; onOpen: (href: string) => void }) {
  return (
    <span>
      {label && `${label}: `}
      <Button variant="link" className="ml-1 h-auto p-0 font-mono" onClick={() => onOpen(`/accounting/journal-entries/${id}`)}>
        {id.slice(0, 8)}…
      </Button>
    </span>
  );
}
