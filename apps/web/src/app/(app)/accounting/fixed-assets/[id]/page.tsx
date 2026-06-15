'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';

interface ScheduleRow {
  period_year: number;
  period_month: number;
  opening_nbv_pkr: number;
  depreciation_amount_pkr: number;
  closing_nbv_pkr: number;
  posted_at: string | null;
}
interface FixedAsset {
  id: string;
  asset_number: string;
  asset_name: string;
  asset_category: string;
  purchase_date: string;
  purchase_cost_pkr: number;
  useful_life_years: number | null;
  wdv_rate_percent: number | null;
  depreciation_method: string;
  depreciation_start_date: string | null;
  status: string;
  accumulated_depreciation_pkr: number;
  net_book_value_pkr: number;
  asset_account_code: string;
  accum_depr_account_code: string;
  depr_expense_account_code: string;
  purchase_journal_entry_id: string | null;
  disposal_journal_entry_id: string | null;
  notes: string | null;
  schedules: ScheduleRow[];
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

export default function FixedAssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;
  const { user } = useAuthStore();
  const isOwner = hasMinRole(user?.role, 'OWNER');

  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCommission, setShowCommission] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [commissionDate, setCommissionDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [disposalProceeds, setDisposalProceeds] = useState('');

  const fetchAsset = useCallback(async () => {
    setLoading(true);
    try {
      setAsset(await apiClient<FixedAsset>(`/v1/fixed-assets/${id}`));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  async function commission() {
    try {
      await apiClient(`/v1/fixed-assets/${id}/commission`, { method: 'POST', body: { depreciation_start_date: commissionDate } });
      setShowCommission(false);
      toast.success('Asset commissioned');
      fetchAsset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  }

  async function dispose() {
    try {
      await apiClient(`/v1/fixed-assets/${id}/dispose`, { method: 'POST', body: { disposal_date: disposalDate, disposal_proceeds_pkr: Number(disposalProceeds) } });
      setShowDispose(false);
      toast.success('Asset disposed · JE-14 posted');
      fetchAsset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!asset) return <p className="text-destructive">Asset not found</p>;

  return (
    <div>
      <PageHeader
        title={asset.asset_name}
        crumb={asset.asset_number}
        description={`${asset.asset_category} · Purchased ${asset.purchase_date}${asset.depreciation_start_date ? ` · In service since ${asset.depreciation_start_date}` : ''}`}
        actions={
          <>
            {isOwner && asset.status === 'PURCHASED' && <Button onClick={() => setShowCommission(true)}>Commission</Button>}
            {isOwner && (asset.status === 'PURCHASED' || asset.status === 'IN_SERVICE') && (
              <Button variant="outline" className="text-destructive" onClick={() => setShowDispose(true)}>Dispose</Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{asset.asset_number}</span>
            <StatusBadge status={asset.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Purchase Cost" value={`Rs. ${asset.purchase_cost_pkr.toLocaleString()}`} />
            <Kpi label="Accum. Depreciation" value={`Rs. ${asset.accumulated_depreciation_pkr.toLocaleString()}`} tone="text-amber-700" />
            <Kpi label="Net Book Value" value={`Rs. ${asset.net_book_value_pkr.toLocaleString()}`} tone="text-green-700" />
            <Kpi label="Depreciation" value={`${asset.depreciation_method} ${asset.wdv_rate_percent ? `${asset.wdv_rate_percent}%` : `${asset.useful_life_years}yr`}`} />
          </div>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            <div>
              Asset acct <span className="font-mono">{asset.asset_account_code}</span> · Accum. depr. <span className="font-mono">{asset.accum_depr_account_code}</span> · Expense <span className="font-mono">{asset.depr_expense_account_code}</span>
            </div>
            {asset.purchase_journal_entry_id && (
              <div>Purchase JE: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${asset.purchase_journal_entry_id}`)}>{asset.purchase_journal_entry_id.slice(0, 8)}…</Button></div>
            )}
            {asset.disposal_journal_entry_id && (
              <div>Disposal JE: <Button variant="link" className="h-auto p-0 font-mono" onClick={() => router.push(`/accounting/journal-entries/${asset.disposal_journal_entry_id}`)}>{asset.disposal_journal_entry_id.slice(0, 8)}…</Button></div>
            )}
            {asset.notes && <div>Notes: {asset.notes}</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Depreciation Schedule</h2>
          <p className="text-xs text-muted-foreground">Posted entries from monthly depreciation runs.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Opening NBV</TableHead>
              <TableHead className="text-right">Depreciation</TableHead>
              <TableHead className="text-right">Closing NBV</TableHead>
              <TableHead>Posted At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {asset.schedules.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No depreciation runs yet</TableCell></TableRow>
            ) : (
              asset.schedules.map((s) => (
                <TableRow key={`${s.period_year}-${s.period_month}`}>
                  <TableCell className="font-mono">{s.period_year}-{String(s.period_month).padStart(2, '0')}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.opening_nbv_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{s.depreciation_amount_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{s.closing_nbv_pkr.toLocaleString()}</TableCell>
                  <TableCell className="text-muted-foreground">{s.posted_at?.slice(0, 19).replace('T', ' ') ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showCommission} onOpenChange={setShowCommission}>
        <DialogContent>
          <DialogHeader><DialogTitle>Commission Asset</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Sets status to IN_SERVICE and starts depreciation accrual.</p>
          <div className="space-y-1.5">
            <Label>Depreciation Start Date</Label>
            <Input type="date" value={commissionDate} onChange={(e) => setCommissionDate(e.target.value)} className="tabular-nums" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommission(false)}>Cancel</Button>
            <Button onClick={commission}>Commission</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDispose} onOpenChange={setShowDispose}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dispose Asset</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Current NBV: Rs. {asset.net_book_value_pkr.toLocaleString()}. Posts JE-14 with gain (4230) or loss (6110) vs proceeds.
          </p>
          <div className="space-y-1.5">
            <Label>Disposal Date</Label>
            <Input type="date" value={disposalDate} onChange={(e) => setDisposalDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Proceeds (PKR)</Label>
            <Input type="number" min={0} step={0.01} value={disposalProceeds} onChange={(e) => setDisposalProceeds(e.target.value)} placeholder="0 if scrapped" className="tabular-nums" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDispose(false)}>Cancel</Button>
            <Button className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={dispose}>Dispose</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
