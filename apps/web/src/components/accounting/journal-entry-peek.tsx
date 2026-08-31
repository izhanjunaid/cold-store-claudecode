'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { hasMinRole } from '@/lib/rbac';
import { useConfirm } from '@/components/form/confirm-dialog';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate, formatDateTime } from '@/lib/format';

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
  description: string;
  posting_status: 'AUTO_DRAFT' | 'POSTED' | 'REVERSED';
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

/**
 * The JE facts + lines + a Post action, without leaving whatever list put
 * the user here. One component, mounted two ways: a Sheet quick-view from a
 * GL line (fills the previously-unused `entry_id` in every GL row) and
 * `DataTable.renderExpanded` on the JE list (post several drafts without
 * navigating away). Read-only for anything already POSTED/REVERSED — a
 * posted entry is immutable at the DB level, so there is no edit affordance
 * here, ever.
 */
export function JournalEntryPeek({ entryId, onPosted }: { entryId: string; onPosted?: () => void }) {
  const { user } = useAuthStore();
  const confirm = useConfirm();
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiClient<JournalEntry>(`/v1/accounting/journal-entries/${entryId}`)
      .then(setEntry)
      .finally(() => setLoading(false));
  }, [entryId]);

  if (loading) return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!entry) return <p className="py-6 text-center text-sm text-muted-foreground">Entry not found</p>;

  // KATCHI writes are OWNER-only; PACCI needs MANAGER+ — mirrors the detail page.
  const canWriteBook = entry.book_type === 'KATCHI' ? user?.role === 'OWNER' : hasMinRole(user?.role, 'MANAGER');
  const canPostDraft = entry.posting_status === 'AUTO_DRAFT' && canWriteBook;

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
      const updated = await apiClient<JournalEntry>(`/v1/accounting/journal-entries/${entry.id}/post`, { method: 'POST', body: {} });
      setEntry(updated);
      toast.success('Entry posted to the ledger');
      onPosted?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{entry.entry_number}</span>
            <StatusBadge status={entry.reversed_by_entry_number ? 'REVERSED' : entry.posting_status} tone={STATUS_TONE[entry.reversed_by_entry_number ? 'REVERSED' : entry.posting_status]} />
            <span className={entry.book_type === 'KATCHI' ? 'text-2xs font-medium text-amber-600' : 'text-2xs font-medium text-muted-foreground'}>
              {entry.book_type}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{entry.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canPostDraft && (
            <Button size="sm" onClick={postDraft} disabled={posting}>
              {posting ? 'Posting…' : 'Post to ledger'}
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/accounting/journal-entries/${entry.id}`}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open
            </Link>
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div><dt className="text-muted-foreground">Date</dt><dd className="font-medium">{formatDate(entry.entry_date)}</dd></div>
        <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium">{entry.entry_type}</dd></div>
        <div><dt className="text-muted-foreground">Created</dt><dd className="font-medium">{formatDateTime(entry.created_at)}</dd></div>
        <div><dt className="text-muted-foreground">By</dt><dd className="font-medium">{entry.created_by_name}</dd></div>
      </dl>

      <Table>
        <TableHeader>
          <TableRow className="h-8 hover:bg-transparent">
            <TableHead className="h-8">Account</TableHead>
            <TableHead className="h-8">Memo</TableHead>
            <TableHead className="h-8 text-right">Debit</TableHead>
            <TableHead className="h-8 text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entry.lines.map((l) => (
            <TableRow key={l.id} className="h-7">
              <TableCell className="py-1"><span className="font-mono text-xs">{l.account_code}</span><span className="ml-2 text-xs text-muted-foreground">{l.account_name}</span></TableCell>
              <TableCell className="py-1 text-xs text-muted-foreground">{l.description ?? '—'}</TableCell>
              <TableCell className="py-1 text-right text-xs tabular-nums">{l.debit_amount > 0 ? l.debit_amount.toLocaleString() : ''}</TableCell>
              <TableCell className="py-1 text-right text-xs tabular-nums">{l.credit_amount > 0 ? l.credit_amount.toLocaleString() : ''}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
