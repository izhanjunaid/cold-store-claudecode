'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, TriangleAlert, Undo2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { useConfirm } from '@/components/form/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

import { formatDate, formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface JournalEntryLine {
  id: string;
  line_number: number;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  party_name: string | null;
  lot_number: string | null;
  description: string | null;
}
interface JournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  entry_type: string;
  book_type: 'PACCI' | 'KATCHI';
  source_table: string;
  source_id: string;
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
  reversed_by_id: string | null;
  reversed_by_entry_number: string | null;
  total_debit_pkr: number;
  total_credit_pkr: number;
  created_at: string;
  created_by_name: string;
  lines: JournalEntryLine[];
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  POSTED: 'success',
  AUTO_DRAFT: 'warning',
  REVERSED: 'danger',
};

export default function JournalEntryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const confirm = useConfirm();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const [reversing, setReversing] = useState(false);

  useEffect(() => {
    apiClient<JournalEntry>(`/v1/accounting/journal-entries/${params.id}`).then(setEntry).finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <PageSkeleton />;
  if (!entry) return <p className="text-muted-foreground">Entry not found</p>;

  const balanced = Math.abs(entry.total_debit_pkr - entry.total_credit_pkr) < 0.01;
  // KATCHI writes are OWNER-only; PACCI needs MANAGER+.
  const canWriteBook =
    entry.book_type === 'KATCHI' ? user?.role === 'OWNER' : hasMinRole(user?.role, 'MANAGER');
  const canPostDraft = entry.posting_status === 'AUTO_DRAFT' && canWriteBook;
  // Only manual entries are reversible here — system entries are corrected
  // through their source document (credit note, dishonour, write-off).
  const canReverse =
    entry.posting_status === 'POSTED' && entry.source_table === 'manual' && canWriteBook;

  const postDraft = async () => {
    const period = new Date(`${entry.entry_date}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const ok = await confirm({
      title: `Post ${entry.entry_number} to the ledger?`,
      description: `This adds the entry to the ${entry.book_type} book in ${period}. Once posted it appears in every report and cannot be edited — corrections need a reversal entry.`,
      confirmText: 'Post entry',
    });
    if (!ok) return;
    setPosting(true);
    try {
      const updated = await apiClient<JournalEntry>(`/v1/accounting/journal-entries/${entry.id}/post`, {
        method: 'POST',
        body: {},
      });
      setEntry(updated);
      toast.success('Entry posted to the ledger');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  const reverseEntry = async () => {
    if (!reverseReason.trim()) return;
    setReversing(true);
    try {
      const reversal = await apiClient<JournalEntry>(`/v1/accounting/journal-entries/${entry.id}/reverse`, {
        method: 'POST',
        body: { reason: reverseReason.trim() },
      });
      toast.success(`${entry.entry_number} reversed by ${reversal.entry_number}`);
      setShowReverse(false);
      router.push(`/accounting/journal-entries/${reversal.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReversing(false);
    }
  };

  return (
    <div>
      <PageHeader title={entry.entry_number} crumb={entry.entry_number} description={entry.description} />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center justify-between">
            <StatusBadge status={entry.posting_status} tone={STATUS_TONE[entry.posting_status]} />
            <div className="flex items-center gap-2">
              {canPostDraft && (
                <Button size="sm" onClick={postDraft} disabled={posting}>
                  {posting ? 'Posting…' : 'Post to ledger'}
                </Button>
              )}
              {canReverse && (
                <Button size="sm" variant="outline" onClick={() => { setReverseReason(''); setShowReverse(true); }}>
                  <Undo2 className="mr-1.5 h-4 w-4" aria-hidden /> Reverse entry…
                </Button>
              )}
            </div>
          </div>
          {entry.posting_status === 'AUTO_DRAFT' && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              This is a draft — it is not included in the general ledger or any financial report until posted.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div><dt className="text-muted-foreground">Entry Date</dt><dd className="font-medium">{formatDate(entry.entry_date)}</dd></div>
            <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium">{entry.entry_type}</dd></div>
            <div><dt className="text-muted-foreground">Book</dt><dd className="font-medium">{entry.book_type}</dd></div>
            <div><dt className="text-muted-foreground">Source</dt><dd className="font-mono text-xs">{entry.source_table}</dd></div>
            <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{formatDateTime(entry.created_at)}</dd></div>
            <div><dt className="text-muted-foreground">Created By</dt><dd className="font-medium">{entry.created_by_name}</dd></div>
            {entry.reversed_by_entry_number && (
              <div>
                <dt className="text-muted-foreground">Reversed By</dt>
                <dd>
                  {entry.reversed_by_id ? (
                    <Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => router.push(`/accounting/journal-entries/${entry.reversed_by_id}`)}>
                      {entry.reversed_by_entry_number}
                    </Button>
                  ) : (
                    <span className="font-mono text-xs">{entry.reversed_by_entry_number}</span>
                  )}
                </dd>
              </div>
            )}
            {entry.entry_type === 'REVERSAL' && entry.source_table === 'journal_entries' && (
              <div>
                <dt className="text-muted-foreground">Reverses</dt>
                <dd>
                  <Button variant="link" className="h-auto p-0 font-mono text-xs" onClick={() => router.push(`/accounting/journal-entries/${entry.source_id}`)}>
                    View original entry
                  </Button>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <div className="border-b px-4 py-3"><h2 className="text-sm font-semibold">Lines</h2></div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Party</TableHead>
              <TableHead>Lot</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs text-muted-foreground">{l.line_number}</TableCell>
                <TableCell><span className="font-mono">{l.account_code}</span><span className="ml-2 text-muted-foreground">{l.account_name}</span></TableCell>
                <TableCell>{l.description ?? '—'}</TableCell>
                <TableCell>{l.party_name ?? '—'}</TableCell>
                <TableCell className="font-mono">{l.lot_number ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{l.debit_amount > 0 ? l.debit_amount.toLocaleString() : ''}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{l.credit_amount > 0 ? l.credit_amount.toLocaleString() : ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-semibold">Totals</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{entry.total_debit_pkr.toLocaleString()}</TableCell>
              <TableCell className="text-right tabular-nums font-semibold">{entry.total_credit_pkr.toLocaleString()}</TableCell>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={7} className="text-right">
                <span className={`inline-flex items-center gap-1.5 ${balanced ? 'text-green-600' : 'text-destructive'}`}>
                  {balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
                  {balanced ? 'Balanced' : 'UNBALANCED'}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <Dialog open={showReverse} onOpenChange={(o) => !o && setShowReverse(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse {entry.entry_number}?</DialogTitle>
            <DialogDescription>
              This posts a new entry dated today with every debit and credit swapped, and marks{' '}
              {entry.entry_number} as reversed. Both entries stay on the {entry.book_type} book
              permanently — nothing is deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason (required)</Label>
            <Input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. Amount entered against the wrong account"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReverse(false)}>Cancel</Button>
            <Button onClick={reverseEntry} disabled={reversing || !reverseReason.trim()}>
              {reversing ? 'Reversing…' : 'Reverse entry'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
