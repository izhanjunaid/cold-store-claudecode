'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  DEFAULT_BANK_ACCOUNT_CODE,
  localIsoDate,
  payrollLineNet,
  payrollRunTotals,
  round2,
  type PayrollRunActionType,
} from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useAccounts } from '@/hooks/use-reference-data';
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
  voided_at: string | null;
  void_reason: string | null;
  /** What the run's state allows next — the server decides, the page only adds permissions. */
  allowed_actions: PayrollRunActionType[];
  line_items: LineItem[];
  salaries_payable: {
    gl_salaries_payable_pkr: number;
    unpaid_net_pay_pkr: number;
    difference_pkr: number;
    is_reconciled: boolean;
  } | null;
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
 * A daily-wage line's gross is days x daily wage, computed by the server on save.
 * The preview reads the wage back off the saved line (the server stored exactly
 * days x wage), so it shows what the save will produce.
 */
function previewDailyGross(saved: LineItem | undefined, days: number): number | null {
  if (!saved || !saved.days_worked) return null;
  return round2((saved.gross_pay_pkr / saved.days_worked) * days);
}

/**
 * A native `<input type="number">` sanitizes its `.value` to `""` for any
 * intermediate string that isn't a complete valid number — "22." while
 * typing "22.5", or a fully-cleared field. Binding that straight through
 * `Number(e.target.value)` turns a decimal keystroke into a silent write of 0.
 * This holds its own text buffer, resyncing from `value` only when it changes
 * from outside (e.g. a refetch), and calls `onChange` only once the text
 * actually parses — so an in-progress edit never corrupts draftLines.
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
  const canFinalize = can(user, 'payroll.finalize');
  const canRemit = can(user, 'payroll.remit');
  const canViewSlips = can(user, 'payroll.view');
  const canDraft = can(user, 'payroll.draft');
  const canReverse = can(user, 'payroll.reverse');
  const canPeekJe = can(user, 'accounting.view');

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPay, setShowPay] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [showReverse, setShowReverse] = useState(false);
  const [showVoidPayment, setShowVoidPayment] = useState(false);
  const [paymentDate, setPaymentDate] = useState(localIsoDate());
  const [remitDate, setRemitDate] = useState(localIsoDate());
  const [payFrom, setPayFrom] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  const [remitFrom, setRemitFrom] = useState(DEFAULT_BANK_ACCOUNT_CODE);
  // Salaries and statutory remittances come out of cash or a bank account — the
  // chart's own cash-equivalent flag, so an owner's second bank account appears.
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter((a) => a.is_cash_equivalent);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [peekEntryId, setPeekEntryId] = useState<string | null>(null);

  // Draft-run batch line editing. Seeded from the fetched run and reset every
  // time a fresh run is fetched (including right after a save).
  const [draftLines, setDraftLines] = useState<LineItem[]>([]);
  const [saving, setSaving] = useState(false);

  // Only the first fetch shows the full-page skeleton.
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
              income_tax_pkr: l.income_tax_pkr,
              advance_recovery_pkr: l.advance_recovery_pkr,
              // Daily wages: the server computes gross from days worked.
              ...(l.employee_type === 'DAILY_WAGE'
                ? l.days_worked !== null ? { days_worked: l.days_worked } : {}
                : { gross_pay_pkr: l.gross_pay_pkr }),
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

  /** Every state change goes through here: one request in flight, then a refetch. */
  async function act(path: string, body: Record<string, unknown>, done: string, close: () => void) {
    setBusy(true);
    try {
      await apiClient(`/v1/payroll-runs/${id}/${path}`, { method: 'POST', body });
      close();
      toast.success(done);
      await fetchRun();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
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

  const allows = (a: PayrollRunActionType) => run.allowed_actions.includes(a);
  const editing = allows('edit_lines') && canDraft;
  const isDailyWage = run.payroll_type === 'DAILY_WAGES';
  // The same rule the server applies — one net and total formula (docs/25 C-23).
  const totals = payrollRunTotals(draftLines);
  const withheldEmployeeEobi = payrollRunTotals(run.line_items).employeeEobi;
  const withheldTax = payrollRunTotals(run.line_items).incomeTax;

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
              onChange={(n) => {
                const gross = previewDailyGross(run.line_items.find((l) => l.id === row.id), n);
                update({ days_worked: n, ...(gross === null ? {} : { gross_pay_pkr: gross }) });
              }} />
          ),
        }]
      : []),
    {
      key: 'gross', header: 'Gross', width: '120px', align: 'right',
      render: (row, update) =>
        row.employee_type === 'DAILY_WAGE' ? (
          <span className="tabular-nums" title="Days worked × daily wage">{row.gross_pay_pkr.toLocaleString()}</span>
        ) : (
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
    {
      key: 'advance', header: 'Advance', width: '110px', align: 'right',
      render: (row, update) => (
        <NumCell value={row.advance_recovery_pkr} step={0.01} min={0} disabled={saving} className="h-8 text-right tabular-nums"
          onChange={(n) => update({ advance_recovery_pkr: n })} />
      ),
    },
    {
      key: 'net', header: 'Net Pay', width: '120px', align: 'right',
      render: (row) => {
        const net = payrollLineNet(row);
        return <span className={`tabular-nums font-medium ${net < 0 ? 'text-destructive' : 'text-green-700'}`}>{net.toLocaleString()}</span>;
      },
    },
    ...(canViewSlips
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

  const openReason = (open: (v: boolean) => void) => { setReason(''); open(true); };

  return (
    <div>
      <PageHeader
        title={`Payroll ${run.period_year}-${String(run.period_month).padStart(2, '0')} (${run.payroll_type === 'MONTHLY_SALARY' ? 'Salary' : 'Wages'})`}
        crumb={run.run_number}
        description={`${run.period_from} → ${run.period_to}`}
        actions={
          <>
            {allows('finalize') && canFinalize && (
              <Button
                onClick={() => act('finalize', {}, 'Payroll finalized', () => {})}
                disabled={isDirty || busy}
                title={isDirty ? 'Save changes before finalizing' : undefined}
              >
                Finalize
              </Button>
            )}
            {allows('pay') && canFinalize && <Button onClick={() => setShowPay(true)} disabled={busy}>Pay salaries</Button>}
            {allows('remit') && canRemit && (
              <Button variant="outline" onClick={() => setShowRemit(true)} disabled={busy}>Remit EOBI / tax</Button>
            )}
            {allows('void_payment') && canReverse && (
              <Button variant="outline" className="text-destructive" onClick={() => openReason(setShowVoidPayment)} disabled={busy}>
                Void payment…
              </Button>
            )}
            {allows('reverse') && canReverse && (
              <Button variant="outline" className="text-destructive" onClick={() => openReason(setShowReverse)} disabled={busy}>
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
          {run.status === 'REVERSED' && run.void_reason && (
            <div className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Reversed{run.voided_at ? ` on ${run.voided_at.slice(0, 10)}` : ''}: {run.void_reason}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Total Gross{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums">{formatMoney(totals.gross)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Deductions{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums text-amber-600">{formatMoney(totals.deductions)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Employer EOBI</div><div className="text-lg font-semibold tabular-nums">{formatMoney(totals.employerEobi)}</div></div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Net Payable{editing && isDirty ? ' (unsaved)' : ''}</div><div className="text-lg font-semibold tabular-nums text-green-700">{formatMoney(totals.net)}</div></div>
          </div>
          {run.status !== 'DRAFT' && run.salaries_payable && (
            <div
              className={
                run.salaries_payable.is_reconciled
                  ? 'mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground'
                  : 'mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'
              }
            >
              {run.salaries_payable.is_reconciled ? (
                <>
                  Ledger agrees with the payroll register: Salaries Payable carries{' '}
                  {formatMoney(run.salaries_payable.gl_salaries_payable_pkr)}, the net pay of every finalised run not yet
                  paid.
                </>
              ) : (
                <>
                  <strong>The ledger and the payroll register disagree.</strong> Salaries Payable carries{' '}
                  {formatMoney(run.salaries_payable.gl_salaries_payable_pkr)}, but the finalised runs not yet paid add up to{' '}
                  {formatMoney(run.salaries_payable.unpaid_net_pay_pkr)} — a difference of{' '}
                  {formatMoney(run.salaries_payable.difference_pkr)}. Raise it before paying.
                </>
              )}
            </div>
          )}
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            {run.payroll_journal_entry_id && jeLink('Payroll entry', run.payroll_journal_entry_id)}
            {run.payment_journal_entry_id && jeLink('Payment entry', run.payment_journal_entry_id)}
            {run.remittance_journal_entry_id && jeLink('Remittance entry', run.remittance_journal_entry_id)}
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
              // Unreachable: maxRows = current length hides Add — a run's roster is
              // fixed at draft creation, the API has no add-line endpoint.
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
                    <TableCell className="py-1 text-right tabular-nums text-amber-600">{l.advance_recovery_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right font-medium tabular-nums text-green-700">{l.net_pay_pkr.toLocaleString()}</TableCell>
                    <TableCell className="py-1 text-right">
                      {canViewSlips && <Button variant="link" size="sm" className="h-auto p-0" onClick={() => viewSlip(l.id)}>Slip</Button>}
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
          <p className="text-sm text-muted-foreground">
            Pays the run&apos;s net salaries of {formatMoney(run.total_net_payable_pkr)} and clears them from Salaries Payable.
          </p>
          <div className="space-y-1.5">
            <Label>Payment Date</Label>
            <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Pay From</Label>
            <select value={payFrom} onChange={(e) => setPayFrom(e.target.value)} className={SELECT_CLASS}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPay(false)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() => act('pay', { payment_date: paymentDate, from_asset_account_code: payFrom }, 'Salaries paid', () => setShowPay(false))}
            >
              Pay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRemit} onOpenChange={setShowRemit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remit EOBI / Tax</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pays the EOBI contributions and income tax this run withheld to the government and clears the amounts owed.
          </p>
          <div className="space-y-1.5">
            <Label>Remittance Date</Label>
            <Input type="date" value={remitDate} onChange={(e) => setRemitDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Remit From</Label>
            <select value={remitFrom} onChange={(e) => setRemitFrom(e.target.value)} className={SELECT_CLASS}>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRemit(false)}>Cancel</Button>
            <Button
              disabled={busy}
              onClick={() =>
                act(
                  'remit',
                  {
                    remittance_date: remitDate,
                    from_asset_account_code: remitFrom,
                    remit_employee_eobi_pkr: withheldEmployeeEobi,
                    remit_employer_eobi_pkr: run.total_employer_eobi_pkr,
                    remit_income_tax_pkr: withheldTax,
                  },
                  'EOBI / tax remitted',
                  () => setShowRemit(false),
                )
              }
            >
              Remit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showVoidPayment} onOpenChange={setShowVoidPayment}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void Salary Payment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Undoes a payment recorded in error — the wrong account or date. The salaries stay owed and the run returns to
            Finalized, ready to be paid again. The original payment and its reversal both stay on the ledger.
          </p>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid from the wrong account" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoidPayment(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || !reason.trim()}
              onClick={() => act('void-payment', { reason: reason.trim() }, 'Payment voided', () => setShowVoidPayment(false))}
            >
              {busy ? 'Voiding…' : 'Void payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReverse} onOpenChange={setShowReverse}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reverse Payroll Run</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Undoes a run finalized in error: the salary cost and the amounts owed are reversed and any advance recovered
            through it is owed again. Both the original and its reversal stay on the ledger. A run that has been paid
            cannot be reversed until its payment is voided.
          </p>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong period finalized" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReverse(false)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || !reason.trim()}
              onClick={() => act('reverse', { reason: reason.trim() }, 'Payroll run reversed', () => setShowReverse(false))}
            >
              {busy ? 'Reversing…' : 'Reverse run'}
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
