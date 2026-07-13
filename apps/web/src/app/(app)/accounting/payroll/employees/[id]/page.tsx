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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { UrduText } from '@/components/ui/urdu-text';
import { formatDate, formatMoney } from '@/lib/format';

import { PageSkeleton } from '@/components/page-skeleton';
interface Employee {
  id: string;
  name: string;
  name_urdu: string | null;
  cnic: string | null;
  employee_type: 'SALARIED' | 'DAILY_WAGE';
  designation: string | null;
  join_date: string;
  basic_salary_pkr: number | null;
  daily_wage_pkr: number | null;
  eobi_registered: boolean;
  bank_account_number: string | null;
  bank_name: string | null;
  is_active: boolean;
  termination_date: string | null;
  notes: string | null;
}

export default function EmployeeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isOwner = can(user, 'employees.terminate');

  const [emp, setEmp] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTerminate, setShowTerminate] = useState(false);
  const [terminationDate, setTerminationDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  const fetchEmp = useCallback(async () => {
    setLoading(true);
    try {
      setEmp(await apiClient<Employee>(`/v1/employees/${id}`));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchEmp(); }, [fetchEmp]);

  async function terminate() {
    setError(null);
    try {
      await apiClient(`/v1/employees/${id}/terminate`, { method: 'POST', body: { termination_date: terminationDate } });
      setShowTerminate(false);
      toast.success('Employee terminated');
      fetchEmp();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to terminate');
    }
  }

  if (loading) return <PageSkeleton />;
  if (!emp) return <p className="text-destructive">Employee not found</p>;

  const pay = emp.employee_type === 'SALARIED'
    ? `${formatMoney(emp.basic_salary_pkr)}/mo`
    : `${formatMoney(emp.daily_wage_pkr)}/day`;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={emp.name}
        crumb={emp.name}
        description={`${emp.designation ?? 'No designation'} · ${emp.employee_type === 'SALARIED' ? 'Salaried' : 'Daily Wage'} · Joined ${formatDate(emp.join_date)}`}
        actions={
          isOwner && emp.is_active && (
            <Button variant="outline" className="text-destructive" onClick={() => setShowTerminate(true)}>Terminate</Button>
          )
        }
      />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            {emp.name_urdu && <UrduText className="text-lg">{emp.name_urdu}</UrduText>}
            <StatusBadge status={emp.is_active ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Pay</div>
              <div className="text-lg font-semibold tabular-nums">{pay}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">CNIC</div>
              <div className="font-mono">{emp.cnic ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">EOBI</div>
              <div>{emp.eobi_registered ? '✓ Registered' : '—'}</div>
            </div>
            {emp.bank_account_number && (
              <div className="col-span-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Bank</div>
                <div>{emp.bank_name ?? ''} · {emp.bank_account_number}</div>
              </div>
            )}
            {emp.termination_date && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Terminated</div>
                <div className="text-destructive">{formatDate(emp.termination_date)}</div>
              </div>
            )}
          </div>
          {emp.notes && (
            <div className="mt-4">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
              <div className="text-sm text-muted-foreground">{emp.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showTerminate} onOpenChange={setShowTerminate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Terminate Employee</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Termination Date</Label>
            <Input type="date" value={terminationDate} onChange={(e) => setTerminationDate(e.target.value)} className="tabular-nums" />
          </div>
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTerminate(false)}>Cancel</Button>
            <Button variant="outline" className="text-destructive" onClick={terminate}>Terminate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
