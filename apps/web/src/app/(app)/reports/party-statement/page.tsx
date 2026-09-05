'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { hasMinRole } from '@/lib/rbac';
import { useParties } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';

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
  const [partyId, setPartyId] = useState('');
  const [dateFrom, setDateFrom] = useState(range.from);
  const [dateTo, setDateTo] = useState(range.to);
  const [bookType, setBookType] = useState<'PACCI' | 'KATCHI'>('PACCI');

  const { data: parties = [] } = useParties();
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.id, label: p.name })), [parties]);

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
            <div className="space-y-1">
              <Label>Party</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Date from</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="tabular-nums" />
              </div>
              <div className="space-y-1">
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
