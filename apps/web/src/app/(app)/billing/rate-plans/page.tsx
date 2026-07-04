'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';

import { formatDate, formatMoney } from '@/lib/format';
import { DataTableSkeleton } from '@/components/data-table';
interface RatePlan {
  id: string;
  name: string;
  commodity_name: string | null;
  rate_type: string;
  rate_amount_pkr: number;
  season_start_date: string | null;
  season_end_date: string | null;
  is_active: boolean;
}

const RATE_TYPE_LABELS: Record<string, string> = {
  SEASONAL_PER_BAG: 'Seasonal / Bag',
  MONTHLY_PER_BAG: 'Monthly / Bag',
  DAILY_PER_BAG: 'Daily / Bag',
};
const SELECT_CLASS = 'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function RatePlanListPage() {
  const confirm = useConfirm();
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('');

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (activeFilter) params.set('is_active', activeFilter);
      const qs = params.toString();
      setPlans(await apiClient<RatePlan[]>(`/v1/rate-plans${qs ? `?${qs}` : ''}`));
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const handleDeactivate = async (id: string) => {
    if (!(await confirm({ title: 'Deactivate rate plan?', confirmText: 'Deactivate', destructive: true }))) return;
    try {
      await apiClient(`/v1/rate-plans/${id}`, { method: 'DELETE' });
      toast.success('Rate plan deactivated');
      fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not deactivate the rate plan');
    }
  };

  return (
    <div>
      <PageHeader
        title="Rate Plans"
        description="Storage tariffs by commodity and billing basis"
        actions={
          <>
            <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} className={SELECT_CLASS}>
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <Button asChild>
              <Link href="/billing/rate-plans/new">
                <Plus className="h-4 w-4" aria-hidden />
                New Rate Plan
              </Link>
            </Button>
          </>
        }
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Commodity</TableHead>
              <TableHead>Rate Type</TableHead>
              <TableHead className="text-right">Rate (PKR)</TableHead>
              <TableHead>Season</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={7} rows={5} />
            ) : plans.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No rate plans found</TableCell></TableRow>
            ) : (
              plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell>{plan.commodity_name || 'All'}</TableCell>
                  <TableCell>{RATE_TYPE_LABELS[plan.rate_type] || plan.rate_type}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatMoney(plan.rate_amount_pkr)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {plan.season_start_date && plan.season_end_date ? `${formatDate(plan.season_start_date)} – ${formatDate(plan.season_end_date)}` : '—'}
                  </TableCell>
                  <TableCell><StatusBadge status={plan.is_active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/billing/rate-plans/${plan.id}/edit`}>
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                          Edit
                        </Link>
                      </Button>
                      {plan.is_active && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeactivate(plan.id)}>
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
