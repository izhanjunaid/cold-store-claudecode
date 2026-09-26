'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { localIsoDate, type FixedAssetActionType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody } from '@/components/ui/sheet';
import { PageHeader } from '@/components/layout/page-header';
import { JournalEntryPeek } from '@/components/accounting/journal-entry-peek';

import { formatDate, formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
import { CATEGORY_LABELS } from '../category-labels';

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
  accumulated_impairment_pkr: number;
  net_book_value_pkr: number;
  asset_account_code: string;
  accum_depr_account_code: string;
  depr_expense_account_code: string;
  purchase_journal_entry_id: string | null;
  disposal_journal_entry_id: string | null;
  is_opening_balance: boolean;
  voided_at: string | null;
  void_reason: string | null;
  /** What the asset's state allows next — decided by the server. */
  allowed_actions: FixedAssetActionType[];
  notes: string | null;
  schedules: ScheduleRow[];
}

/** Corrections that take only a reason: one dialog, one request. */
type Correction = 'reverse_disposal' | 'reverse_depreciation' | 'reverse_impairment' | 'void';
const CORRECTIONS: Record<Correction, { path: string; title: string; button: string; done: string; text: string }> = {
  reverse_disposal: {
    path: 'reverse-disposal',
    title: 'Reverse Disposal',
    button: 'Reverse disposal',
    done: 'Disposal reversed',
    text: 'Undoes a disposal posted in error and puts the asset back on the register. Depreciation up to the disposal date stands.',
  },
  reverse_depreciation: {
    path: 'reverse-depreciation',
    title: 'Reverse Latest Depreciation',
    button: 'Reverse month',
    done: 'Depreciation month reversed',
    text: 'Reverses the most recent month of depreciation on this asset, in that month. The next depreciation run posts it again.',
  },
  reverse_impairment: {
    path: 'reverse-impairment',
    title: 'Reverse Latest Impairment',
    button: 'Reverse impairment',
    done: 'Impairment reversed',
    text: 'Reverses the most recent write-down on this asset, in its own month. Not possible once depreciation has been posted on the written-down amount.',
  },
  void: {
    path: 'void',
    title: 'Void Asset',
    button: 'Void asset',
    done: 'Asset voided',
    text: 'For an asset entered in error: reverses its purchase and takes it off the register. Only possible before any depreciation or impairment is posted on it.',
  },
};

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
  const canManage = can(user, 'fixed_assets.manage');
  const canCorrect = can(user, 'fixed_assets.reverse');
  const canPeekJe = can(user, 'accounting.view');
  const [peekEntryId, setPeekEntryId] = useState<string | null>(null);

  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showCommission, setShowCommission] = useState(false);
  const [showDispose, setShowDispose] = useState(false);
  const [showImpair, setShowImpair] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [impairDate, setImpairDate] = useState(() => localIsoDate());
  const [impairAmount, setImpairAmount] = useState('');
  const [reason, setReason] = useState('');
  const [commissionDate, setCommissionDate] = useState(localIsoDate());
  const [disposalDate, setDisposalDate] = useState(localIsoDate());
  const [disposalProceeds, setDisposalProceeds] = useState('');
  const [openingAccumulated, setOpeningAccumulated] = useState('');

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

  /** Every state change goes through here: one request in flight, then a refetch. */
  async function act(path: string, body: Record<string, unknown>, done: string, close: () => void) {
    setBusy(true);
    try {
      await apiClient(`/v1/fixed-assets/${id}/${path}`, { method: 'POST', body });
      close();
      toast.success(done);
      await fetchAsset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (!asset) return <p className="text-destructive">Asset not found</p>;

  const allows = (a: FixedAssetActionType) => asset.allowed_actions.includes(a);
  const openWithReason = (open: () => void) => { setReason(''); open(); };
  const jeButton = (entryId: string) => (
    <Button variant="link" className="h-auto p-0 font-mono" onClick={() => (canPeekJe ? setPeekEntryId(entryId) : router.push(`/accounting/journal-entries/${entryId}`))}>
      {entryId.slice(0, 8)}…
    </Button>
  );
  const current = correction ? CORRECTIONS[correction] : null;

  return (
    <div>
      <PageHeader
        title={asset.asset_name}
        crumb={asset.asset_number}
        description={`${CATEGORY_LABELS[asset.asset_category] ?? asset.asset_category} · Purchased ${formatDate(asset.purchase_date)}${asset.depreciation_start_date ? ` · In service since ${formatDate(asset.depreciation_start_date)}` : ''}`}
        actions={
          <>
            {canManage && allows('commission') && <Button onClick={() => setShowCommission(true)} disabled={busy}>Commission</Button>}
            {canManage && allows('impair') && (
              <Button variant="outline" onClick={() => openWithReason(() => setShowImpair(true))} disabled={busy}>Impair…</Button>
            )}
            {canManage && allows('dispose') && (
              <Button variant="outline" className="text-destructive" onClick={() => setShowDispose(true)} disabled={busy}>Dispose</Button>
            )}
            {canCorrect && allows('convert_to_opening') && (
              <Button variant="outline" onClick={() => openWithReason(() => setShowConvert(true))} disabled={busy}>
                Already in opening balances…
              </Button>
            )}
            {canCorrect &&
              (Object.keys(CORRECTIONS) as Correction[])
                .filter((c) => allows(c))
                .map((c) => (
                  <Button key={c} variant="outline" className="text-destructive" onClick={() => openWithReason(() => setCorrection(c))} disabled={busy}>
                    {CORRECTIONS[c].button}…
                  </Button>
                ))}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{asset.asset_number}</span>
            <StatusBadge status={asset.voided_at ? 'VOIDED' : asset.status} />
            {asset.is_opening_balance && <span className="text-xs text-muted-foreground">Owned at go-live — carried by the opening balances</span>}
          </div>
          {asset.voided_at && (
            <div className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Voided on {asset.voided_at.slice(0, 10)}: {asset.void_reason}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Kpi label="Purchase Cost" value={`${formatMoney(asset.purchase_cost_pkr)}`} />
            <Kpi label="Accum. Depreciation" value={`${formatMoney(asset.accumulated_depreciation_pkr)}`} tone="text-amber-700" />
            {asset.accumulated_impairment_pkr > 0 && (
              <Kpi label="Accum. Impairment" value={`${formatMoney(asset.accumulated_impairment_pkr)}`} tone="text-destructive" />
            )}
            <Kpi label="Net Book Value" value={`${formatMoney(asset.net_book_value_pkr)}`} tone="text-green-700" />
            <Kpi label="Depreciation" value={`${asset.depreciation_method} ${asset.wdv_rate_percent ? `${asset.wdv_rate_percent}%` : `${asset.useful_life_years}yr`}`} />
          </div>
          <div className="mt-4 space-y-1 text-sm text-muted-foreground">
            <div>
              Asset acct <span className="font-mono">{asset.asset_account_code}</span> · Accum. depr. <span className="font-mono">{asset.accum_depr_account_code}</span> · Expense <span className="font-mono">{asset.depr_expense_account_code}</span>
            </div>
            {asset.purchase_journal_entry_id && <div>Purchase entry: {jeButton(asset.purchase_journal_entry_id)}</div>}
            {asset.disposal_journal_entry_id && <div>Disposal entry: {jeButton(asset.disposal_journal_entry_id)}</div>}
            {asset.notes && <div>Notes: {asset.notes}</div>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Depreciation Schedule</h2>
          <p className="text-xs text-muted-foreground">Months posted by depreciation runs.</p>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="h-8 hover:bg-transparent">
              <TableHead className="h-8">Period</TableHead>
              <TableHead className="h-8 text-right">Opening NBV</TableHead>
              <TableHead className="h-8 text-right">Depreciation</TableHead>
              <TableHead className="h-8 text-right">Closing NBV</TableHead>
              <TableHead className="h-8">Posted At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {asset.schedules.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No depreciation posted yet</TableCell></TableRow>
            ) : (
              asset.schedules.map((s) => (
                <TableRow key={`${s.period_year}-${s.period_month}`} className="h-7">
                  <TableCell className="py-1 font-mono">{s.period_year}-{String(s.period_month).padStart(2, '0')}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums">{s.opening_nbv_pkr.toLocaleString()}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums text-amber-700">{s.depreciation_amount_pkr.toLocaleString()}</TableCell>
                  <TableCell className="py-1 text-right tabular-nums font-medium">{s.closing_nbv_pkr.toLocaleString()}</TableCell>
                  <TableCell className="py-1 text-muted-foreground">{s.posted_at?.slice(0, 19).replace('T', ' ') ?? '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={peekEntryId !== null} onOpenChange={(o) => !o && setPeekEntryId(null)}>
        <SheetContent size="lg">
          <SheetHeader>
            <SheetTitle>Journal Entry</SheetTitle>
          </SheetHeader>
          <SheetBody>{peekEntryId && <JournalEntryPeek entryId={peekEntryId} />}</SheetBody>
        </SheetContent>
      </Sheet>

      <Dialog open={showCommission} onOpenChange={setShowCommission}>
        <DialogContent>
          <DialogHeader><DialogTitle>Commission Asset</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Puts the asset into service; depreciation starts from this date (not before it was bought).</p>
          <div className="space-y-1.5">
            <Label>Depreciation Start Date</Label>
            <Input type="date" value={commissionDate} onChange={(e) => setCommissionDate(e.target.value)} className="tabular-nums" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCommission(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => act('commission', { depreciation_start_date: commissionDate }, 'Asset commissioned', () => setShowCommission(false))}>
              Commission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDispose} onOpenChange={setShowDispose}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dispose Asset</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            The asset is first depreciated for every month it was used up to the disposal date; the difference between
            its carrying amount then and the proceeds is recorded as a gain or loss on disposal. Current carrying amount:{' '}
            {formatMoney(asset.net_book_value_pkr)}.
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
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={() =>
                act('dispose', { disposal_date: disposalDate, disposal_proceeds_pkr: Number(disposalProceeds) || 0 }, 'Asset disposed', () => setShowDispose(false))
              }
            >
              Dispose
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showImpair} onOpenChange={setShowImpair}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record Impairment</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Write the asset down to what it is actually worth — a failed compressor, flood damage, an accident. The
            write-down is kept separate from depreciation so cost, depreciation and impairment stay readable side by side,
            and later depreciation spreads what is left over the remaining life. The asset is depreciated up to the
            impairment date first.
            <br />
            Carrying amount now: {formatMoney(asset.net_book_value_pkr)} — the most that can be written down.
          </p>
          <div className="space-y-1.5">
            <Label>Impairment Date</Label>
            <Input type="date" value={impairDate} onChange={(e) => setImpairDate(e.target.value)} className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Amount (PKR)</Label>
            <Input type="number" min={0} step={0.01} value={impairAmount} onChange={(e) => setImpairAmount(e.target.value)} placeholder="0.00" className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. compressor failed beyond economic repair" maxLength={300} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImpair(false)}>Cancel</Button>
            <Button
              disabled={busy || !reason.trim() || !(Number(impairAmount) > 0)}
              onClick={() =>
                act(
                  'impair',
                  { impairment_date: impairDate, amount_pkr: Number(impairAmount), reason: reason.trim() },
                  'Impairment recorded',
                  () => { setShowImpair(false); setImpairAmount(''); },
                )
              }
            >
              Record impairment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConvert} onOpenChange={setShowConvert}>
        <DialogContent>
          <DialogHeader><DialogTitle>Already in the Opening Balances</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This asset was bought before go-live and its cost is also in the opening-balance entry, so it is counted twice.
            This reverses its purchase and keeps it on the register as an asset owned at go-live. Enter the depreciation the
            opening balances already carry for it.
          </p>
          <div className="space-y-1.5">
            <Label>Depreciation to go-live (PKR)</Label>
            <Input type="number" min={0} step={0.01} value={openingAccumulated} onChange={(e) => setOpeningAccumulated(e.target.value)} placeholder="0.00" className="tabular-nums" />
          </div>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered here and in the opening balances" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConvert(false)}>Cancel</Button>
            <Button
              disabled={busy || !reason.trim()}
              onClick={() =>
                act(
                  'convert-to-opening',
                  { reason: reason.trim(), opening_accumulated_depreciation_pkr: Number(openingAccumulated) || 0 },
                  'Moved onto the opening register',
                  () => setShowConvert(false),
                )
              }
            >
              Reverse purchase, keep asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={correction !== null} onOpenChange={(o) => !o && setCorrection(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{current?.title}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {current?.text} Both the original and its reversal stay on the ledger — nothing is deleted.
          </p>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Posted in error" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrection(null)}>Cancel</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy || !reason.trim() || !current}
              onClick={() => current && act(current.path, { reason: reason.trim() }, current.done, () => setCorrection(null))}
            >
              {busy ? 'Working…' : current?.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
