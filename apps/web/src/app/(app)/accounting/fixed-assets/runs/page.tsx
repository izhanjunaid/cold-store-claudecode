'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { MONTH_NAMES_SHORT } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

import { formatMoney } from '@/lib/format';
import { DataTableSkeleton } from '@/components/data-table';
interface RunSummary {
  period_year: number;
  period_month: number;
  asset_count: number;
  total_depreciation_pkr: number;
}

const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function DepreciationRunsPage() {
  const { user } = useAuthStore();
  const canRun = can(user, 'fixed_assets.manage');
  // The informal book is the owner's alone (a fixed seniority rule, not a permission).
  const canUseKatchi = hasMinRole(user?.role, 'OWNER');
  const [book, setBook] = useState<'PACCI' | 'KATCHI'>('PACCI');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runYear, setRunYear] = useState(new Date().getFullYear());
  const [runMonth, setRunMonth] = useState(new Date().getMonth() + 1);
  const [running, setRunning] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await apiClient<RunSummary[]>('/v1/depreciation/runs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  async function executeRun() {
    setRunning(true);
    try {
      const result = await apiClient<{ run_count: number; total_depreciation_pkr: number }>('/v1/depreciation/runs', {
        method: 'POST',
        body: { period_year: runYear, period_month: runMonth, book_type: book },
      });
      setShowRunModal(false);
      toast.success(`Posted ${result.run_count} asset-month(s) · ${formatMoney(result.total_depreciation_pkr)}`);
      fetchRuns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Depreciation Runs"
        description="Monthly depreciation, posted asset by asset"
        actions={canRun && <Button onClick={() => setShowRunModal(true)}><Play className="h-4 w-4" aria-hidden />Run Month</Button>}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow className="h-8 hover:bg-transparent">
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8 text-right">Asset Count</TableHead>
              <TableHead className="h-8 text-right">Total Depreciation (PKR)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={3} rows={5} />
            ) : runs.length === 0 ? (
              <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No depreciation runs yet</TableCell></TableRow>
            ) : (
              runs.map((r) => (
                <TableRow key={`${r.period_year}-${r.period_month}`} className="h-7">
                  <TableCell className="py-1 font-mono">{r.period_year}-{String(r.period_month).padStart(2, '0')}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{r.asset_count}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums font-medium">{r.total_depreciation_pkr.toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showRunModal} onOpenChange={setShowRunModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Run Monthly Depreciation</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Posts depreciation for every asset in service up to the end of the selected month. An asset that has
            missed earlier months is caught up month by month; running a month again posts only what is still missing.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Year</Label>
              <Input type="number" min={2020} max={2100} value={runYear} onChange={(e) => setRunYear(Number(e.target.value))} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Month</Label>
              <select value={runMonth} onChange={(e) => setRunMonth(Number(e.target.value))} className={SELECT_CLASS}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m} — {MONTH_NAMES_SHORT[m - 1]}</option>
                ))}
              </select>
            </div>
            {canUseKatchi && (
              <div className="col-span-2 space-y-1.5">
                <Label>Book</Label>
                <select value={book} onChange={(e) => setBook(e.target.value as 'PACCI' | 'KATCHI')} className={SELECT_CLASS}>
                  <option value="PACCI">Official (PACCI)</option>
                  <option value="KATCHI">Informal (KATCHI)</option>
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRunModal(false)}>Cancel</Button>
            <Button onClick={executeRun} disabled={running}>{running ? 'Running…' : 'Post depreciation'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
