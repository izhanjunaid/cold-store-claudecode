'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/layout/page-header';

import { formatMoney } from '@/lib/format';
interface PartyOption {
  id: string;
  name: string;
  party_type: string;
}
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
  const isOwner = user?.role === 'OWNER';

  const [partyId, setPartyId] = useState(search.get('party_id') ?? '');
  const [partyName, setPartyName] = useState('');
  const [partyQuery, setPartyQuery] = useState('');
  const [partyResults, setPartyResults] = useState<PartyOption[]>([]);

  const [principal, setPrincipal] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<LoanCreated | null>(null);

  useEffect(() => {
    if (partyId && !partyName) {
      apiClient<{ name: string }>(`/v1/parties/${partyId}`).then((p) => setPartyName(p.name)).catch(() => {});
    }
  }, [partyId, partyName]);

  useEffect(() => {
    if (partyId || !partyQuery.trim() || partyQuery.length < 2) {
      setPartyResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiClientList<PartyOption>(`/v1/parties?search=${encodeURIComponent(partyQuery.trim())}&page_size=10`);
        setPartyResults(res.data);
      } catch {
        setPartyResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [partyQuery, partyId]);

  if (user && !isOwner) {
    return (
      <div>
        <PageHeader title="Issue Peshgi" />
        <p className="text-muted-foreground">OWNER role required to issue peshgi.</p>
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
              <div className="flex justify-between"><dt className="text-muted-foreground">Party</dt><dd>{created.party_name ?? partyName}</dd></div>
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
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div className="space-y-1.5">
              <Label>Party <span className="text-destructive">*</span></Label>
              {partyId ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <span className="text-sm">{partyName || partyId}</span>
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => { setPartyId(''); setPartyName(''); setPartyQuery(''); }}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Input value={partyQuery} onChange={(e) => setPartyQuery(e.target.value)} placeholder="Search by name…" />
                  {partyResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
                      {partyResults.map((p) => (
                        <li key={p.id} onClick={() => { setPartyId(p.id); setPartyName(p.name); }} className="flex cursor-pointer justify-between px-3 py-2 text-sm hover:bg-accent">
                          <span>{p.name}</span>
                          <span className="text-xs text-muted-foreground">{p.party_type}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Principal (PKR) <span className="text-destructive">*</span></Label>
              <Input type="number" step={0.01} min={0.01} value={principal} onChange={(e) => setPrincipal(e.target.value)} required className="tabular-nums" />
            </div>

            <div className="space-y-1.5">
              <Label>Payment Method <span className="text-destructive">*</span></Label>
              <div className="flex gap-2">
                {(['CASH', 'BANK_TRANSFER'] as const).map((m) => (
                  <Button key={m} type="button" variant={paymentMethod === m ? 'default' : 'outline'} size="sm" onClick={() => setPaymentMethod(m)}>
                    {m === 'CASH' ? 'Cash (1010)' : 'Bank Transfer (1020)'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Issue Date <span className="text-destructive">*</span></Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required className="tabular-nums" />
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={submitting || !partyId}>{submitting ? 'Issuing…' : 'Issue Peshgi'}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
