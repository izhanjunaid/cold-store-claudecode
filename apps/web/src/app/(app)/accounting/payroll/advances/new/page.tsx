'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

interface EmployeeOption {
  id: string;
  name: string;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  basic_salary_pkr: number | null;
  daily_wage_pkr: number | null;
}
interface AdvanceCreated {
  id: string;
  advance_number: string;
  employee_name?: string;
  principal_pkr: number;
  issue_journal_entry_id: string | null;
}

export default function IssueEmployeeAdvancePage() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'OWNER';

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState(search.get('employee_id') ?? '');

  const [principal, setPrincipal] = useState('');
  const [installment, setInstallment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<AdvanceCreated | null>(null);

  useEffect(() => {
    apiClientList<EmployeeOption>('/v1/employees?is_active=true&page_size=200')
      .then((res) => setEmployees(res.data))
      .catch(() => {});
  }, []);

  if (user && !isOwner) {
    return (
      <div>
        <PageHeader title="Issue Employee Advance" />
        <p className="text-muted-foreground">OWNER role required to issue an employee advance.</p>
      </div>
    );
  }

  const employeeOptions: ComboboxOption[] = employees.map((e) => ({
    value: e.id,
    label: e.name,
    hint: e.employee_type === 'SALARIED' ? `${formatMoney(e.basic_salary_pkr)}/mo` : `${formatMoney(e.daily_wage_pkr)}/day`,
  }));
  const selectedEmployee = employees.find((e) => e.id === employeeId);
  const monthlyCap = selectedEmployee
    ? selectedEmployee.employee_type === 'SALARIED'
      ? Number(selectedEmployee.basic_salary_pkr ?? 0)
      : Number(selectedEmployee.daily_wage_pkr ?? 0) * 26
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!employeeId) return setError('Select an employee');
    const principalNum = Number(principal);
    const installmentNum = Number(installment);
    if (!Number.isFinite(principalNum) || principalNum <= 0) return setError('Enter a valid principal amount');
    if (!Number.isFinite(installmentNum) || installmentNum <= 0) return setError('Enter a valid monthly instalment');
    setSubmitting(true);
    try {
      const data = await apiClient<AdvanceCreated>('/v1/employee-advances/issue', {
        method: 'POST',
        body: {
          employee_id: employeeId,
          issue_date: issueDate,
          principal_pkr: principalNum,
          monthly_installment_pkr: installmentNum,
          payment_method: paymentMethod,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue advance');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Advance Issued" crumb="Issued" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              <span className="font-medium">Advance issued successfully</span>
            </div>
            <dl className="space-y-1 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Advance No.</dt><dd className="font-mono">{created.advance_number}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Employee</dt><dd>{created.employee_name ?? selectedEmployee?.name}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Principal</dt><dd className="tabular-nums">{formatMoney(Number(created.principal_pkr))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Journal Entry</dt><dd className="font-mono text-xs">{created.issue_journal_entry_id ?? '—'}</dd></div>
            </dl>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/accounting/payroll/advances/${created.id}`)}>View Advance</Button>
              <Button variant="outline" onClick={() => { setCreated(null); setPrincipal(''); setInstallment(''); setNotes(''); }}>Issue Another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Issue Employee Advance" crumb="Issue" description="Cash advance against future salary, recovered automatically through payroll" />
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <EntrySheet>
          <EntryGroup title="Advance" columns={2}>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Employee <span className="text-destructive">*</span></Label>
              <Combobox
                options={employeeOptions}
                value={employeeId}
                onChange={setEmployeeId}
                placeholder="Select employee…"
                searchPlaceholder="Search employees…"
                testId="combobox-employee_id"
              />
              {monthlyCap !== null && (
                <p className="text-xs text-muted-foreground">One month&apos;s pay cap: {formatMoney(monthlyCap)}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Principal (PKR) <span className="text-destructive">*</span></Label>
              <Input type="number" step={0.01} min={0.01} value={principal} onChange={(e) => setPrincipal(e.target.value)} required className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Monthly Instalment (PKR) <span className="text-destructive">*</span></Label>
              <Input type="number" step={0.01} min={0.01} value={installment} onChange={(e) => setInstallment(e.target.value)} required className="tabular-nums" />
              <p className="text-xs text-muted-foreground">Pre-filled on future payroll drafts; the accountant can adjust it each run.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Issue date <span className="text-destructive">*</span></Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment method <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                  <Button key={m} type="button" variant={paymentMethod === m ? 'default' : 'outline'} size="sm" onClick={() => setPaymentMethod(m)}>
                    {m === 'CASH' ? 'Cash' : 'Bank Transfer'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
            </div>
          </EntryGroup>
        </EntrySheet>

        <FormActions>
          <Button type="submit" disabled={submitting || !employeeId}>{submitting ? 'Issuing…' : 'Issue Advance'}</Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </FormActions>
      </form>
    </div>
  );
}
