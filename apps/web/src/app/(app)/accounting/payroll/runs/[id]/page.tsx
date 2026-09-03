'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { DEFAULT_BANK_ACCOUNT_CODE } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import { PageHeader } from '@/components/layout/page-header';
import { EditableRows, type EditableRowColumn } from '@/components/form';
import { JournalEntryPeek } from '@/components/accounting/journal-entry-peek';

import { formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  advance_recovery_pkr: number;
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
  status: 'DRAFT' | 'FINALIZED' | 'PAID' | 'REVERSED';
  payroll_journal_entry_id: string | null;
  payment_journal_entry_id: string | null;
  remittance_journal_entry_id: string | null;
  finalized_at: string | null;
  paid_at: string | null;
  notes: string | null;
  line_items: LineItem[];
  reconciliation: {
    gl_salaries_payable_pkr: number;
    register_net_pay_pkr: number;
    difference_pkr: number;
    is_reconciled: boolean;
  } | null;
}

/** Client preview only — mirrors payroll-run.service.ts's updateLine formula exactly.
 *  The server recomputes and validates (advance-recovery cap against the live
 *  outstanding balance) authoritatively on save; this never invents its own cap. */
function computeNetPay(l: LineItem): number {
  return round2(l.gross_pay_pkr - l.eobi_employee_pkr - l.income_tax_pkr - l.other_deductions_pkr - l.advance_recovery_pkr);
}

function linesEqual(a: LineItem, b: LineItem | undefined): boolean {
  if (!b) return false;
  return (
    a.gross_pay_pkr === b.gross_pay_pkr &&
    a.income_tax_pkr === b.income_tax_pkr &&
    a.advance_recovery_pkr === b.advance_recovery_pkr &&
    a.days_worked === b.days_worked
  );
}

/**
 * A native `<input type="number">` sanitizes its `.value` to `""` for any
 * intermediate string that isn't a complete valid number — "22." while
 * typing "22.5", or a fully-cleared field. Binding that straight through
 * `Number(e.target.value)` (as the modal this replaced never did — it kept
 * string state and parsed once at submit) turns a decimal keystroke into a
 * silent write of 0. This holds its own text buffer, resyncing from `value`
 * only when it changes from outside (e.g. a refetch), and calls `onChange`
 * only once the text actually parses — so an in-progress edit never
 * corrupts draftLines, and a cleared field just stays undirtied instead of
 * silently PATCHing nothing while the toast claims success.
 */
function NumCell({
  value, onChange, step, min, disabled, className,
}: {
  value: number | null; onChange: (n: number) => void; step?: number; min?: number; disabled?: boolean; className?: string;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText(value === null ? '' : String(value)); }, [value]);
  return (
    <Input
      type="number" step={step} min={min} disabled={disabled} className={className}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

export default function PayrollRunDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isManager = can(user, 'payroll.finalize');
  const isOwner = can(user, 'payroll.remit');
  const isAccountant = can(user, 'payroll.view');
  const canDraft = can(user, 'payroll.draft');
  const canReverse = can(user, 'payroll.reverse');
  const canPeekJe = can(user, 'accounting.view');

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [showReverse, setShowReverse] = useState(false);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [remitDate, setRemitDate] = useState(new Date().toISOString().slice(0, 10));
  // Both default to 1020 (bank) so an untouched dialog posts exactly as it did
  // when these were bare literals in the request body.
  const [payFrom, setPayFrom] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  const [remitFrom, setRemitFrom] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  // Salaries and statutory remittances come out of cash or bank only — never an
  // arbitrary detail account.
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [peekEntryId, setPeekEntryId] = useState<string | null>(null);

  // Draft-run batch line editing. Seeded from the fetched run and reset every
  // time a fresh run is fetched (including right after a save) — that reset
  // is what clears "dirty" state, so no separate manual-reset path is needed.
  const [draftLines, setDraftLines] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Only the first fetch shows the full-page skeleton — a refetch after Save
  // Changes shouldn't blank the whole grid the user is looking at. A ref
  // (not state) so it doesn't churn fetchRun's identity or the load effect.
  const hasLoadedRef = useRef(false);
  const fetchRun = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const data = await apiClient<PayrollRun>(`/v1/payroll-runs/${id}`);
      setRun(data);
      setDraftLines(data.line_items);
      hasLoadedRef.current = true;
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchRun(); }, [fetchRun]);

  const isDirty = run !== null && draftLines.some((l, i) => !linesEqual(l, run.line_items[i]));

  async function saveChanges() {
    if (!run) return;
    setSaving(true);
    try {
      const dirty = draftLines.filter((l, i) => !linesEqual(l, run.line_items[i]));
      const results = await Promise.allSettled(
        dirty.map((l) =>
          apiClient(`/v1/payroll-runs/${id}/lines/${l.id}`, {
            method: 'PATCH',
            body: {
              gross_pay_pkr: l.gross_pay_pkr,
              income_tax_pkr: l.income_tax_pkr,
              advance_recovery_pkr: l.advance_recovery_pkr,
              ...(run.payroll_type === 'DAILY_WAGES' && l.days_worked !== null ? { days_worked: l.days_worked } : {}),
            },
          }),
        ),
      );
      const failedCount = results.filter((r) => r.status === 'rejected').length;
      const okCount = results.length - failedCount;
      if (okCount > 0) toast.success(`Saved ${okCount} line${okCount === 1 ? '' : 's'}`);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          const line = dirty[i]!;
          toast.error(`${line.employee_name}: ${r.reason instanceof Error ? r.reason.message : 'Save failed'}`);
        }
      });
      await fetchRun();
    } finally {
      setSaving(false);
    }
  }

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
        body: { payment_date: paymentDate, from_asset_account_code: payFrom },
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
          from_asset_account_code: remitFrom,
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

  async function reverseRun() {
    if (!reverseReason.trim()) return;
    setReversing(true);
    try {
      await apiClient(`/v1/payroll-runs/${id}/reverse`, {
        method: 'POST',
        body: { reason: reverseReason.trim() },
      });
      setShowReverse(false);
      toast.success('Payroll run reversed');
      fetchRun();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reversal failed');
    } finally {
      setReversing(false);
    }
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

  const editing = run.status === 'DRAFT' && canDraft;
  const isDailyWage = run.payroll_type === 'DAILY_WAGES';

  // Single source of truth for the KPI card, whether editing or not — while
  // read-only, draftLines mirrors run.line_items exactly, so this is one code
  // path rather than a branch that could show two disagreeing totals.
  const totals = draftLines.reduce(
    (acc, l) => {
      acc.gross += l.gross_pay_pkr;
      acc.deductions += l.eobi_employee_pkr + l.income_tax_pkr + l.other_deductions_pkr + l.advance_recovery_pkr;
      acc.eobiEmployer += l.eobi_employer_pkr;
      acc.net += computeNetPay(l);
      return acc;
    },
    { gross: 0, deductions: 0, eobiEmployer: 0, net: 0 },
  );

  const lineColumns: EditableRowColumn<LineItem>[] = [
    { key: 'employee', header: 'Employee', width: '2fr', render: (row) => <span className="font-medium">{row.employee_name}</span> },
    ...(isDailyWage
      ? [{
          key: 'days',
          header: 'Days',
          width: '80px',
          align: 'right' as const,
          render: (row: LineItem, update: (patch: Partial<LineItem>) => void) => (
            <NumCell value={row.days_worked} step={0.5} min={0} disabled={saving} className="h-8 text-right tabular-nums"
              onChange={(n) => update({ days_worked: n })} />
          ),
        }]
      : []),
    {
      key: 'gross', header: 'Gross', width: '120px', align: 'right',
      render: (row, update) => (
        <NumCell value={row.gross_pay_pkr} step={0.01} min={0} disabled={saving} className="h-8 text-right tabular-nums"
          onChange={(n) => update({ gross_pay_pkr: n })} />
      ),
    },
    { key: 'eobi', header: 'EOBI (E)', width: '90px', align: 'right', render: (row) => <span className="tabular-nums text-amber-600">{row.eobi_employee_pkr.toLocaleString()}</span> },
    {
      key: 'tax', header: 'Tax', width: '110px', align: 'right',
      render: (row, update) => (
        <NumCell value={row.income_tax_pkr} step={0.01} min={0} disabled={saving} className="h-8 text-right tabular-nums"
          onChange={(n) => update({ income_tax_pkr: n })} />
      ),
    },
    { key: 'other', header: 'Other', width: '90px', align: 'right', render: (row) => <span className="tabular-nums">{row.other_deductions_pkr.toLocaleString()}</span> },
    {
      key: 'advance', header: 'Advance', width: '110px', align: 'right',
      render: (row, update) => (
        <NumCell value={row.advance_recovery_pkr} step={0.01} min={0} disabled={saving} className="h-8 text-right tabular-nums"
          onChange={(n) => update({ advance_recovery_pkr: n })} />
      ),
    },
    { key: 'net', header: 'Net Pay', width: '120px', align: 'right', render: (row) => <span className="tabular-nums font-medium text-green-700">{computeNetPay(row).toLocaleString()}</span> },
    ...(isAccountant
      ? [{
          key: 'slip', header: '', width: '56px', align: 'right' as const,
          render: (row: LineItem) => (
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => viewSlip(row.id)}>Slip</Button>
          ),
        }]
      : []),
  ];

  const jeLink = (label: string, entryId: string) =>
    canPeekJe ? (
      <div>{label}: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => setPeekEntryId(entryId)}>{entryId.slice(0, 8)}…</Button></div>
    ) : (
      <div>{label}: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${entryId}`)}>{entryId.slice(0, 8)}…</Button></div>
    );

  return (
    <div>
      <PageHeader
        title={`Payroll ${run.period_year}-${String(run.period_month).padStart(2, '0')} (${run.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'})`}
        crumb={run.run_number}
        description={`${run.period_from} → ${run.period_to}`}
        actions={
          <>
            {isManager && run.status === 'DRAFT' && (
              <Button onClick={finalize} disabled={isDirty} title={isDirty ? 'Save changes before finalizing' : undefined}>
                Finalize (post JE-15{run.payroll_type === 'DAILY_WAGES' ? 'B' : ''})
              </Button>
            )}
            {isManager && run.status === 'FINALIZED' && <Button onClick={() => setShowPay(true)}>Pay (post JE-16)</Button>}
            {isOwner && run.status !== 'DRAFT' && !run.remittance_journal_entry_id && (
              <Button variant="outline" onClick={() => setShowRemit(true)}>Remit EOBI/Tax (JE-16B)</Button>
            )}
            {canReverse && run.status !== 'DRAFT' && run.status !== 'REVERSED' && (
              <Button variant="outline" className="text-destructive" onClick={() => { setReverseReason(''); setShowReverse(true); }}>
                Reverse run…
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{run.run_number}</span>
            <StatusBadge status={run.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Total Gross{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums">{formatMoney(totals.gross)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Deductions{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums text-amber-600">{formatMoney(totals.deductions)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Employer EOBI</div><div className="text-lg font-semibold tabular-nums">{formatMoney(totals.eobiEmployer)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Net Payable{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums text-green-700">{formatMoney(totals.net)}</div></div>
          </div>
          {run.reconciliation && (
            <div
              className={
                run.reconciliation.is_reconciled
                  ? 'mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground'
                  : 'mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'
              }
            >
              {run.reconciliation.is_reconciled ? (
                <>
                  Ledger agrees with the register: 2030 Salaries Payable carries{' '}
                  {formatMoney(run.reconciliation.gl_salaries_payable_pkr)} for this run, the same as
                  the {run.line_items.length} line items below add up to.
                </>
              ) : (
                <>
                  <strong>The ledger and the register disagree.</strong> 2030 Salaries Payable carries{' '}
                  {formatMoney(run.reconciliation.gl_salaries_payable_pkr)} for this run but the line
                  items add up to {formatMoney(run.reconciliation.register_net_pay_pkr)} — a difference
                  of {formatMoney(run.reconciliation.difference_pkr)}. The books and the payroll
                  register are describing the same wages differently; raise it before paying.
                </>
              )}
            </div>
          )}
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            {run.payroll_journal_entry_id && jeLink('Payroll JE', run.payroll_journal_entry_id)}
            {run.payment_journal_entry_id && jeLink('Payment JE-16', run.payment_journal_entry_id)}
            {run.remittance_journal_entry_id && jeLink('Remittance JE-16B', run.remittance_journal_entry_id)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Line Items ({run.line_items.length} employees)</h2>
            {editing && isDirty && (
              <Button size="sm" onClick={saveChanges} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
            )}
          </div>

          {editing ? (
            <EditableRows
              rows={draftLines}
              onChange={setDraftLines}
              columns={lineColumns}
              // Unreachable: maxRows = current length hides Add immediately — a
              // run's roster is fixed at draft creation, the API has no
              // add-line endpoint.
              newRow={() => draftLines[0]!}
              removable={false}
              maxRows={draftLines.length}
              disabled={saving}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="h-8 hover:bg-transparent">
                  <TableHead className="h-8">Employee</TableHead>
                  <TableHead className="h-8 text-right">Days</TableHead>
                  <TableHead className="h-8 text-right">Gross</TableHead>
                  <TableHead className="h-8 text-right">EOBI (E)</TableHead>
                  <TableHead className="h-8 text-right">Tax</TableHead>
                  <TableHead className="h-8 text-right">Other</TableHead>
                  <TableHead className="h-8 text-right">Advance</TableHead>
                  <TableHead className="h-8 text-right">Net Pay</TableHead>
                  <TableHead className="h-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.line_items.map((l) => (
                  <TableRow key={l.id} className="h-7">
                    <TableCell className="py-1 font-medium">{l.employee_name}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{l.days_worked ?? '—'}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{l.gross_pay_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-amber-600">{l.eobi_employee_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{l.income_tax_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{l.other_deductions_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums text-amber-600">{l.advance_recovery_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right font-medium tabular-nums text-green-700">{l.net_pay_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right">
                      {isAccountant && <Button variant="link" size="sm" className="h-auto p-0" onClick={() => viewSlip(l.id)}>Slip</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={showPay} onOpenChange={setShowPay}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay Salaries</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Posts JE-16: DR 2030 {formatMoney(run.total_net_payable_pkr)} / CR {payFrom}.</p>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Pay From</Label>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className={SELECT_CLASS}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
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
          <p className="text-sm text-muted-foreground">Posts JE-16B clearing 2060/2061/2070 against {remitFrom}.</p>
          <div className="space-y-1.5">
            <Label>Remittance Date</Label>
            <Input type="date" value={remitDate} onChange={(e) => setRemitDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Remit From</Label>
            <select value={remitFrom} onChange={(e) => setRemitFrom(e.target.value)} className={SELECT_CLASS}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemit(false)}>Cancel</Button>
            <Button onClick={remit}>Remit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReverse} onOpenChange={setShowReverse}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse Payroll Run</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Posts reversing entries for every JE this run created and marks it REVERSED. Both the
            original and reversal stay on the ledger permanently — nothing is deleted.
          </p>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. Wrong period finalized"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReverse(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={reverseRun}
              disabled={reversing || !reverseReason.trim()}
            >
              {reversing ? 'Reversing…' : 'Reverse run'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={peekEntryId !== null} onOpenChange={(o) => !o && setPeekEntryId(null)}>
        <SheetContent size="lg">
          <SheetHeader>
            <SheetTitle>Journal Entry</SheetTitle>
          </SheetHeader>
          <SheetBody>{peekEntryId && <JournalEntryPeek entryId={peekEntryId} />}</SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
