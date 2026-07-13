'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function NewEmployeePage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = can(user, 'employees.manage');

  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [cnic, setCnic] = useState('');
  const [type, setType] = useState<'SALARIED' | 'DAILY_WAGE'>('SALARIED');
  const [designation, setDesignation] = useState('');
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10));
  const [salary, setSalary] = useState('');
  const [wage, setWage] = useState('');
  const [eobiRegistered, setEobiRegistered] = useState(true);
  const [bankAcct, setBankAcct] = useState('');
  const [bankName, setBankName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="New Employee" />
        <p className="text-muted-foreground">Requires MANAGER role or higher.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name,
        name_urdu: nameUrdu || null,
        cnic: cnic || null,
        employee_type: type,
        designation: designation || null,
        join_date: joinDate,
        eobi_registered: eobiRegistered,
        bank_account_number: bankAcct || null,
        bank_name: bankName || null,
      };
      if (type === 'SALARIED') payload['basic_salary_pkr'] = Number(salary);
      else payload['daily_wage_pkr'] = Number(wage);
      const created = await apiClient<{ id: string }>('/v1/employees', { method: 'POST', body: payload });
      toast.success('Employee created');
      router.push(`/accounting/payroll/employees/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create employee');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="New Employee" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input required value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Name (Urdu)</Label>
                <Input dir="rtl" value={nameUrdu} onChange={(e) => setNameUrdu(e.target.value)} className="font-urdu" />
              </div>
              <div className="space-y-1.5">
                <Label>CNIC</Label>
                <Input value={cnic} onChange={(e) => setCnic(e.target.value)} placeholder="42101-1234567-8" />
              </div>
              <div className="space-y-1.5">
                <Label>Type <span className="text-destructive">*</span></Label>
                <select value={type} onChange={(e) => setType(e.target.value as 'SALARIED' | 'DAILY_WAGE')} className={SELECT_CLASS}>
                  <option value="SALARIED">Salaried (monthly)</option>
                  <option value="DAILY_WAGE">Daily Wage</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Designation</Label>
                <Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="Manager, Loader, etc." />
              </div>
              <div className="space-y-1.5">
                <Label>Join Date <span className="text-destructive">*</span></Label>
                <Input type="date" required value={joinDate} onChange={(e) => setJoinDate(e.target.value)} className="tabular-nums" />
              </div>
            </div>

            {type === 'SALARIED' ? (
              <div className="space-y-1.5">
                <Label>Basic Salary (PKR/month) <span className="text-destructive">*</span></Label>
                <Input type="number" required min={0} step={0.01} value={salary} onChange={(e) => setSalary(e.target.value)} className="tabular-nums" />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Daily Wage (PKR/day) <span className="text-destructive">*</span></Label>
                <Input type="number" required min={0} step={0.01} value={wage} onChange={(e) => setWage(e.target.value)} className="tabular-nums" />
              </div>
            )}

            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={eobiRegistered} onCheckedChange={(c) => setEobiRegistered(!!c)} />
              EOBI registered (Rs 375 employee + Rs 1,875 employer per month)
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bank Account Number</Label>
                <Input value={bankAcct} onChange={(e) => setBankAcct(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Bank Name</Label>
                <Input value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            </div>

            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Employee'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
