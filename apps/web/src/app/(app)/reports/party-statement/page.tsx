'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { hasMinRole } from '@/lib/rbac';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

interface PartyOption {
  id: string;
  name: string;
  party_type: string;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function PartyStatementPickerPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canView = can(user, 'reports.financial');

  const range = defaultRange();
  const [partyQuery, setPartyQuery] = useState('');
  const [partyResults, setPartyResults] = useState<PartyOption[]>([]);
  const [partyId, setPartyId] = useState('');
  const [partyName, setPartyName] = useState('');
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [bookType, setBookType] = useState<'PACCI' | 'KATCHI'>('PACCI');

  useEffect(() => {
    if (partyId || !partyQuery.trim() || partyQuery.length < 2) {
      setPartyResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await apiClientList<PartyOption>(
          `/v1/parties?search=${encodeURIComponent(partyQuery.trim())}&page_size=10`,
        );
        setPartyResults(res.data);
      } catch {
        setPartyResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [partyQuery, partyId]);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Party Statement" />
        <p className="text-muted-foreground">Party statement requires ACCOUNTANT role or higher.</p>
      </div>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return;
    const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo, book_type: bookType });
    router.push(`/reports/party-statement/${partyId}?${qs.toString()}`);
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Party Statement" description="Generate a statement of account for any party" />
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Party</Label>
              {partyId ? (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
                  <strong className="text-sm">{partyName}</strong>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      setPartyId('');
                      setPartyName('');
                      setPartyQuery('');
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    value={partyQuery}
                    onChange={(e) => setPartyQuery(e.target.value)}
                    placeholder="Search by name (min 2 chars)…"
                  />
                  {partyResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover shadow-md">
                      {partyResults.map((p) => (
                        <li
                          key={p.id}
                          onClick={() => {
                            setPartyId(p.id);
                            setPartyName(p.name);
                            setPartyResults([]);
                            setPartyQuery('');
                          }}
                          className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
                        >
                          <strong>{p.name}</strong>{' '}
                          <span className="text-xs text-muted-foreground">({p.party_type})</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Date from</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1.5">
                <Label>Date to</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="tabular-nums" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Book type</Label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={bookType === 'PACCI'} onChange={() => setBookType('PACCI')} />
                  PACCI (official)
                </label>
                {hasMinRole(user?.role, 'MANAGER') && (
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={bookType === 'KATCHI'} onChange={() => setBookType('KATCHI')} />
                    KATCHI (informal)
                  </label>
                )}
              </div>
            </div>

            <Button type="submit" disabled={!partyId}>
              View Statement
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
