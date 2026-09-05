'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useParties } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';

import { formatMoney } from '@/lib/format';
interface LoanCreated {
  id: string;
  loan_number: string;
  party_name?: string;
  principal_pkr: number;
  issue_journal_entry_id: string | null;
}

export default function IssuePeshgiPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { user } = useAuthStore();
  const isOwner = can(user, 'loans.issue');

  const { data: parties = [] } = useParties();
  const partyOptions = parties.map((p) => ({ value: p.id, label: p.name, hint: p.party_type }));

  const [partyId, setPartyId] = useState(search.get('party_id') ?? '');
  const [principal, setPrincipal] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<LoanCreated | null>(null);

  if (user && !isOwner) {
    return (
      <div>
        <PageHeader title="Issue Peshgi" />
        <p className="text-muted-foreground">You don&apos;t have permission to issue peshgi.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partyId) return setError('Select a party');
    const principalNum = Number(principal);
    if (!Number.isFinite(principalNum) || principalNum <= 0) return setError('Enter a valid amount');
    setSubmitting(true);
    try {
      const data = await apiClient<LoanCreated>('/v1/loans/issue', {
        method: 'POST',
        body: {
          party_id: partyId,
          issue_date: issueDate,
          principal_pkr: principalNum,
          payment_method: paymentMethod,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
      });
      setCreated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue peshgi');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Peshgi Issued" crumb="Issued" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
              <span className="font-medium">Loan created successfully</span>
            </div>
            <dl className="space-y-1 rounded-md border bg-muted/30 p-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Loan No.</dt><dd className="font-mono">{created.loan_number}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Party</dt><dd>{created.party_name ?? partyOptions.find((p) => p.value === partyId)?.label}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Principal</dt><dd className="tabular-nums">{formatMoney(Number(created.principal_pkr))}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Journal Entry</dt><dd className="font-mono text-xs">{created.issue_journal_entry_id ?? '—'}</dd></div>
            </dl>
            <div className="flex gap-2">
              <Button onClick={() => router.push(`/loans/${created.id}`)}>View Loan</Button>
              <Button variant="outline" onClick={() => { setCreated(null); setPrincipal(''); setNotes(''); }}>Issue Another</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Issue Peshgi" crumb="Issue" description="Informal cash advance to a farmer or arhti" />
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
        )}

        <EntrySheet>
          <EntryGroup title="Peshgi" columns={2}>
            <div className="space-y-1 sm:col-span-2">
              <Label>Party <span className="text-destructive">*</span></Label>
              <Combobox
                options={partyOptions}
                value={partyId}
                onChange={setPartyId}
                placeholder="Select party…"
                searchPlaceholder="Search parties…"
                testId="combobox-party_id"
                className="h-8"
              />
            </div>

            <div className="space-y-1">
              <Label>Principal (PKR) <span className="text-destructive">*</span></Label>
              <Input type="number" step={0.01} min={0.01} value={principal} onChange={(e) => setPrincipal(e.target.value)} required className="tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label>Issue date <span className="text-destructive">*</span></Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className="tabular-nums" />
            </div>

            <div className="space-y-1">
              <Label>Payment method <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                  <Button key={m} type="button" variant={paymentMethod === m ? 'default' : 'outline'} size="sm" onClick={() => setPaymentMethod(m)}>
                    {m === 'CASH' ? 'Cash (1010)' : 'Bank Transfer (1020)'}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
            </div>
          </EntryGroup>
        </EntrySheet>

        <FormActions>
          <Button type="submit" disabled={submitting || !partyId}>{submitting ? 'Issuing…' : 'Issue Peshgi'}</Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </FormActions>
      </form>
    </div>
  );
}
