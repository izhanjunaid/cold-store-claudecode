'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Plus, TriangleAlert, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';

interface Account {
  account_code: string;
  account_name: string;
  account_type: 'HEADER' | 'DETAIL';
  is_active: boolean;
}
interface Line {
  account_code: string;
  debit_amount: string;
  credit_amount: string;
  description: string;
}

const SELECT_CLASS = 'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ account_code: '', debit_amount: '', credit_amount: '', description: '' });

export default function NewJournalEntryPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(today());
  const [description, setDescription] = useState('');
  const [bookType, setBookType] = useState<'PACCI' | 'KATCHI'>('PACCI');
  const [postingStatus, setPostingStatus] = useState<'AUTO_DRAFT' | 'POSTED'>('POSTED');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient<Account[]>('/v1/accounting/accounts?is_active=true').then(setAccounts);
  }, []);

  const detailAccounts = accounts.filter((a) => a.account_type === 'DETAIL' && a.is_active);
  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit_amount) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit_amount) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const updateLine = (idx: number, patch: Partial<Line>) => setLines((c) => c.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((c) => [...c, emptyLine()]);
  const removeLine = (idx: number) => setLines((c) => (c.length > 2 ? c.filter((_, i) => i !== idx) : c));

  const submit = async () => {
    setError(null);
    if (!description.trim()) return setError('Description is required');
    if (!balanced) return setError('Debits and credits must balance to a positive total');
    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string }>('/v1/accounting/journal-entries', {
        method: 'POST',
        body: {
          entry_date: entryDate,
          description: description.trim(),
          book_type: bookType,
          posting_status: postingStatus,
          lines: lines.map((l) => ({
            account_code: l.account_code,
            debit_amount: parseFloat(l.debit_amount) || 0,
            credit_amount: parseFloat(l.credit_amount) || 0,
            description: l.description.trim() || undefined,
          })),
        },
      });
      toast.success(postingStatus === 'POSTED' ? 'Entry posted' : 'Draft saved');
      router.push(`/accounting/journal-entries/${created.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const isOwner = user?.role === 'OWNER';
  const periodLabel = /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
    ? new Date(`${entryDate}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : null;

  return (
    <div className="max-w-4xl">
      <PageHeader title="New Manual Journal Entry" crumb="New" />

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Entry Date</Label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="tabular-nums" />
              {periodLabel && (
                <p className="text-xs text-muted-foreground">Posts to period {periodLabel}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Book Type</Label>
              <select value={bookType} onChange={(e) => setBookType(e.target.value as 'PACCI' | 'KATCHI')} className={SELECT_CLASS + ' h-9'}>
                <option value="PACCI">PACCI (Official)</option>
                {isOwner && <option value="KATCHI">KATCHI (Internal — OWNER only)</option>}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select value={postingStatus} onChange={(e) => setPostingStatus(e.target.value as 'AUTO_DRAFT' | 'POSTED')} className={SELECT_CLASS + ' h-9'}>
                <option value="POSTED">Post to ledger</option>
                <option value="AUTO_DRAFT">Save as draft</option>
              </select>
              {postingStatus === 'AUTO_DRAFT' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Drafts are not in any report until posted from the entry page.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Reclassify Q1 storage adjustment" />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-72">Account</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-32 text-right">Debit</TableHead>
              <TableHead className="w-32 text-right">Credit</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, idx) => (
              <TableRow key={idx}>
                <TableCell>
                  <select value={l.account_code} onChange={(e) => updateLine(idx, { account_code: e.target.value })} className={`${SELECT_CLASS} font-mono`}>
                    <option value="">Select account…</option>
                    {detailAccounts.map((a) => <option key={a.account_code} value={a.account_code}>{a.account_code} — {a.account_name}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  <Input value={l.description} onChange={(e) => updateLine(idx, { description: e.target.value })} placeholder="Optional" className="h-8" />
                </TableCell>
                <TableCell>
                  <Input type="number" step={0.01} min={0} value={l.debit_amount} onChange={(e) => updateLine(idx, { debit_amount: e.target.value, credit_amount: '' })} className="h-8 text-right tabular-nums" />
                </TableCell>
                <TableCell>
                  <Input type="number" step={0.01} min={0} value={l.credit_amount} onChange={(e) => updateLine(idx, { credit_amount: e.target.value, debit_amount: '' })} className="h-8 text-right tabular-nums" />
                </TableCell>
                <TableCell>
                  {lines.length > 2 && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeLine(idx)} aria-label="Remove line"><X className="h-4 w-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t bg-muted/30 px-4 py-3 text-sm">
          <Button variant="link" className="h-auto p-0" onClick={addLine}><Plus className="h-4 w-4" aria-hidden />Add line</Button>
          <div className="flex items-center gap-6">
            <span className="tabular-nums">Dr {totalDebit.toLocaleString()}</span>
            <span className="tabular-nums">Cr {totalCredit.toLocaleString()}</span>
            <span className={`inline-flex items-center gap-1.5 font-medium ${balanced ? 'text-green-600' : 'text-destructive'}`}>
              {balanced ? <CheckCircle2 className="h-4 w-4" /> : <TriangleAlert className="h-4 w-4" />}
              {balanced ? 'Balanced' : `Diff ${Math.abs(totalDebit - totalCredit).toLocaleString()}`}
            </span>
          </div>
        </div>
      </Card>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button onClick={submit} disabled={submitting || !balanced}>
          {submitting ? 'Saving…' : postingStatus === 'POSTED' ? 'Post Entry' : 'Save Draft'}
        </Button>
        <Button variant="outline" onClick={() => router.push('/accounting/journal-entries')}>Cancel</Button>
      </div>
    </div>
  );
}
