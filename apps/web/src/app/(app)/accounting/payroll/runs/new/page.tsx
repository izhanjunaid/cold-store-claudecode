'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function NewPayrollRunPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canCreate = hasMinRole(user?.role, 'ACCOUNTANT');

  const now = new Date();
  const [type, setType] = useState<'MONTHLY_SALARY' | 'DAILY_WAGES'>('MONTHLY_SALARY');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCreate) {
    return (
      <div>
        <PageHeader title="New Payroll Run" />
        <p className="text-muted-foreground">Requires ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  function lastDayOfMonth(y: number, m: number) {
    return new Date(y, m, 0).getDate();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const periodFrom = `${year}-${String(month).padStart(2, '0')}-01`;
      const periodTo = `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
      const created = await apiClient<{ id: string }>('/v1/payroll-runs', {
        method: 'POST',
        body: {
          payroll_type: type,
          period_year: year,
          period_month: month,
          period_from: periodFrom,
          period_to: periodTo,
        },
      });
      toast.success('Draft payroll run created');
      router.push(`/accounting/payroll/runs/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create run');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="New Payroll Run" crumb="New" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A DRAFT run snapshots all active employees of the selected type at current pay rates, with EOBI auto-calculated for
              registered employees (Rs 375 employee + Rs 1,875 employer). You can review each line before finalizing.
            </p>

            <div className="space-y-1.5">
              <Label>Payroll Type <span className="text-destructive">*</span></Label>
              <select value={type} onChange={(e) => setType(e.target.value as 'MONTHLY_SALARY' | 'DAILY_WAGES')} className={SELECT_CLASS}>
                <option value="MONTHLY_SALARY">Monthly Salary (DR 6010, JE-15)</option>
                <option value="DAILY_WAGES">Daily Wages (DR 5030, JE-15B — direct cost)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Year <span className="text-destructive">*</span></Label>
                <Input type="number" required min={2020} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Month <span className="text-destructive">*</span></Label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className={SELECT_CLASS}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m} — {new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                  ))}
                </select>
              </div>
            </div>

            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

            <div className="flex gap-3">
              <Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create Draft'}</Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
