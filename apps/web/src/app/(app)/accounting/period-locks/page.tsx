'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LockKeyhole, LockOpen, Info } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

interface PeriodLock {
  id: string;
  period_year: number;
  period_month: number;
  locked_at: string;
  locked_by_name: string;
  unlocked_at: string | null;
  unlocked_by_name: string | null;
  reason: string | null;
  is_locked: boolean;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { dateStyle: 'medium' });

type PendingAction = { kind: 'lock' | 'unlock'; year: number; month: number } | null;

export default function PeriodLocksPage() {
  const { user } = useAuthStore();
  const canLock = hasMinRole(user?.role, 'MANAGER');
  const canUnlock = user?.role === 'OWNER';

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLocks(await apiClient<PeriodLock[]>('/v1/accounting/period-locks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const lockFor = (m: number) => locks.find((l) => l.period_year === year && l.period_month === m);

  // Closed-through watermark: the latest actively-locked month closes every
  // month before it too, unless a month was explicitly reopened.
  const watermark = locks.reduce(
    (acc, l) => (l.is_locked ? Math.max(acc, l.period_year * 100 + l.period_month) : acc),
    0,
  );
  const watermarkLabel =
    watermark > 0 ? `${MONTHS[(watermark % 100) - 1]} ${Math.floor(watermark / 100)}` : null;

  const submit = async () => {
    if (!pending) return;
    if (pending.kind === 'unlock' && !reason.trim()) {
      toast.error('A reason is required to reopen a closed month');
      return;
    }
    setSubmitting(true);
    try {
      if (pending.kind === 'lock') {
        await apiClient('/v1/accounting/period-locks', {
          method: 'POST',
          body: { period_year: pending.year, period_month: pending.month, reason: reason.trim() || undefined },
        });
        toast.success(`${MONTHS[pending.month - 1]} ${pending.year} closed`);
      } else {
        await apiClient(`/v1/accounting/period-locks/${pending.year}/${pending.month}/unlock`, {
          method: 'POST',
          body: { reason: reason.trim() },
        });
        toast.success(`${MONTHS[pending.month - 1]} ${pending.year} reopened`);
      }
      setPending(null);
      setReason('');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isCurrentOrPast = (m: number) =>
    year < now.getFullYear() || (year === now.getFullYear() && m <= now.getMonth() + 1);

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 3 + i);

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Period Locks"
        description="Close finished months so nothing — invoices, payments, journal entries — can be posted into them."
        crumb="Period Locks"
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Closing a month blocks every posting dated inside it — and closes every earlier month
          with it. Reopening a single month requires the owner and a reason, and both actions are
          kept on the permanent audit record. Close each month once its billing is done.
        </p>
      </div>

      {watermarkLabel && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          <LockKeyhole className="h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">Books are closed through {watermarkLabel}.</span>{' '}
            Nothing can be posted on or before that month unless the owner reopens it.
          </p>
        </div>
      )}

      <div className="mb-4 flex items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Year</Label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={SELECT_CLASS}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="w-40 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MONTHS.map((name, i) => {
              const m = i + 1;
              const lock = lockFor(m);
              const state: 'locked' | 'reopened' | 'open' | 'implied' = lock?.is_locked
                ? 'locked'
                : lock
                  ? 'reopened'
                  : year * 100 + m <= watermark
                    ? 'implied'
                    : 'open';
              return (
                <TableRow key={m} className={!isCurrentOrPast(m) ? 'opacity-50' : undefined}>
                  <TableCell className="font-medium">{name} {year}</TableCell>
                  <TableCell>
                    {state === 'locked' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                        <LockKeyhole className="h-3 w-3" aria-hidden /> Closed
                      </span>
                    )}
                    {state === 'reopened' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <LockOpen className="h-3 w-3" aria-hidden /> Reopened
                      </span>
                    )}
                    {state === 'implied' && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300">
                        <LockKeyhole className="h-3 w-3" aria-hidden /> Closed
                      </span>
                    )}
                    {state === 'open' && <span className="text-xs text-muted-foreground">Open</span>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {state === 'locked' && lock && (
                      <>Closed by {lock.locked_by_name} on {fmt(lock.locked_at)}{lock.reason ? ` — ${lock.reason}` : ''}</>
                    )}
                    {state === 'reopened' && lock && (
                      <>Reopened by {lock.unlocked_by_name} on {lock.unlocked_at ? fmt(lock.unlocked_at) : ''}{lock.reason ? ` — ${lock.reason}` : ''}</>
                    )}
                    {state === 'implied' && <>Covered by the {watermarkLabel} close</>}
                  </TableCell>
                  <TableCell className="text-right">
                    {state === 'locked' || state === 'implied' ? (
                      canUnlock && (
                        <Button variant="outline" size="sm" onClick={() => { setPending({ kind: 'unlock', year, month: m }); setReason(''); }}>
                          Reopen…
                        </Button>
                      )
                    ) : (
                      canLock && (
                        <Button variant="outline" size="sm" onClick={() => { setPending({ kind: 'lock', year, month: m }); setReason(''); }}>
                          Close month…
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {loading && <p className="border-t px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
      </Card>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.kind === 'lock'
                ? `Close ${pending ? MONTHS[pending.month - 1] : ''} ${pending?.year}?`
                : `Reopen ${pending ? MONTHS[pending.month - 1] : ''} ${pending?.year}?`}
            </DialogTitle>
            <DialogDescription>
              {pending?.kind === 'lock'
                ? 'No invoice, payment, expense, or journal entry can be posted into a closed month — and every earlier month closes with it. The owner can reopen a specific month later with a reason.'
                : 'Reopening allows backdated postings into this month again. The reopening is recorded permanently on the audit log.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              Reason{pending?.kind === 'unlock' ? ' (required)' : ' (optional)'}
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={pending?.kind === 'lock' ? 'e.g. Month-end closing complete' : 'e.g. Missed electricity bill for this month'}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button onClick={submit} disabled={submitting || (pending?.kind === 'unlock' && !reason.trim())}>
              {submitting ? 'Saving…' : pending?.kind === 'lock' ? 'Close month' : 'Reopen month'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
