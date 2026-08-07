'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Info, Plus, X } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';

interface OpeningStatus {
  entered: boolean;
  journal_entry_id: string | null;
  entry_number: string | null;
  as_of_date: string | null;
}
interface Party {
  id: string;
  name: string;
  party_type?: string;
}
interface Account {
  account_code: string;
  account_name: string;
  account_type: string;
  account_class: string;
  is_active: boolean;
}
interface ReceivableRow {
  party_id: string;
  amount: string;
}
interface OtherRow {
  account_code: string;
  debit: string;
  credit: string;
  description: string;
}
interface PeriodLock {
  period_year: number;
  period_month: number;
  is_locked: boolean;
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Per-party receivables go through the rows above; peshgi through its module.
// The three cash-class accounts have dedicated fields in Cash & Bank, so they
// are excluded here too — otherwise the same balance could be entered twice.
const BLOCKED_OTHER_CODES = new Set(['1110', '1120', '1130', '1140', '1150', '3010', '1010', '1020', '1030']);

const WALLET_ACCOUNT = '1030';

export default function OpeningBalancesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canEnter = can(user, 'accounting.post_journal');

  const [status, setStatus] = useState<OpeningStatus | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [cash, setCash] = useState('');
  const [bank, setBank] = useState('');
  // 1030 has no dedicated field in the request shape (only cash_pkr -> 1010 and
  // bank_pkr -> 1020), so it rides in as an other_line. Giving it a labelled box
  // here rather than leaving it buried in the "Other" dropdown, where nobody
  // looking for their wallet balance would think to find it.
  const [wallet, setWallet] = useState('');
  const [others, setOthers] = useState<OtherRow[]>([]);
  const [lockedThrough, setLockedThrough] = useState<{ year: number; month: number } | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient<OpeningStatus>('/v1/accounting/opening-balances'),
      apiClientList<Party>('/v1/parties?page_size=200&is_active=true').then((r) => r.data),
      apiClient<Account[]>('/v1/accounting/accounts?is_active=true'),
      // Advisory only — never let it take the screen down with it.
      apiClient<PeriodLock[]>('/v1/accounting/period-locks').catch(() => [] as PeriodLock[]),
    ])
      .then(([st, ps, accs, locks]) => {
        setStatus(st);
        setParties(ps);
        setAccounts(accs);
        // The watermark: the highest still-locked period closes everything at or
        // below it, months nobody explicitly locked included.
        const active = locks.filter((l) => l.is_locked);
        if (active.length > 0) {
          const top = active.reduce((a, b) =>
            b.period_year > a.period_year ||
            (b.period_year === a.period_year && b.period_month > a.period_month)
              ? b
              : a,
          );
          setLockedThrough({ year: top.period_year, month: top.period_month });
        }
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  const otherAccounts = useMemo(
    () =>
      accounts.filter(
        (a) =>
          a.account_type === 'DETAIL' &&
          a.is_active &&
          !BLOCKED_OTHER_CODES.has(a.account_code) &&
          // Opening balances are a balance-sheet exercise.
          ['ASSET', 'LIABILITY', 'EQUITY'].includes(a.account_class),
      ),
    [accounts],
  );

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of receivables) debit += parseFloat(r.amount) || 0;
    debit += parseFloat(cash) || 0;
    debit += parseFloat(bank) || 0;
    debit += parseFloat(wallet) || 0;
    for (const o of others) {
      debit += parseFloat(o.debit) || 0;
      credit += parseFloat(o.credit) || 0;
    }
    const plug = Math.round((debit - credit) * 100) / 100;
    return { debit, credit, plug };
  }, [receivables, cash, bank, wallet, others]);

  // Opening balances are backdated by nature, and postInTransaction asserts the
  // period lock against a closed-through watermark: once any period at or above
  // the as-of month is actively locked, this POST is rejected until an OWNER
  // reopens it. Say so before the form is filled in, not after.
  const blockedByLock =
    lockedThrough !== null &&
    (() => {
      const [y, m] = asOfDate.split('-').map(Number);
      if (!y || !m) return false;
      return y < lockedThrough.year || (y === lockedThrough.year && m <= lockedThrough.month);
    })();

  const hasAnything = totals.debit > 0 || totals.credit > 0;

  const submit = async () => {
    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string; entry_number: string }>(
        '/v1/accounting/opening-balances',
        {
          method: 'POST',
          body: {
            as_of_date: asOfDate,
            party_receivables: receivables
              .filter((r) => r.party_id && (parseFloat(r.amount) || 0) > 0)
              .map((r) => ({ party_id: r.party_id, amount_pkr: parseFloat(r.amount) })),
            cash_pkr: parseFloat(cash) || 0,
            bank_pkr: parseFloat(bank) || 0,
            other_lines: [
              ...((parseFloat(wallet) || 0) > 0
                ? [{
                    account_code: WALLET_ACCOUNT,
                    debit_pkr: parseFloat(wallet),
                    credit_pkr: 0,
                    description: 'Opening mobile wallet balance',
                  }]
                : []),
              ...others
                .filter((o) => o.account_code && ((parseFloat(o.debit) || 0) > 0 || (parseFloat(o.credit) || 0) > 0))
                .map((o) => ({
                  account_code: o.account_code,
                  debit_pkr: parseFloat(o.debit) || 0,
                  credit_pkr: parseFloat(o.credit) || 0,
                  description: o.description.trim() || undefined,
                })),
            ],
          },
        },
      );
      toast.success(`Opening balances posted as ${created.entry_number}`);
      router.push(`/accounting/journal-entries/${created.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to post opening balances');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageSkeleton />;

  if (status?.entered) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Opening Balances" crumb="Opening Balances" description="Balances brought forward from your previous records" />
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" aria-hidden />
              <div className="space-y-2 text-sm">
                <p className="font-medium">
                  Opening balances were entered as of {status.as_of_date}.
                </p>
                <p className="text-muted-foreground">
                  They were posted as journal entry{' '}
                  <Button
                    variant="link"
                    className="h-auto p-0 font-mono text-sm"
                    onClick={() => router.push(`/accounting/journal-entries/${status.journal_entry_id}`)}
                  >
                    {status.entry_number}
                  </Button>
                  . If they were entered incorrectly, open that entry and reverse it — this screen
                  then unlocks for a fresh entry.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Opening Balances"
        crumb="Opening Balances"
        description="Bring balances from your paper registers into the system — one balanced entry, done once at go-live"
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Enter what each party owes you, your cash and bank balances, and any other assets or
          liabilities as of the day before you started using ColdChain. The difference posts to
          Owner&apos;s Capital (3010) automatically. Outstanding peshgi is not entered here — issue
          it through the Loans module so recovery tracking works.
        </p>
      </div>

      {!canEnter && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Only a manager or the owner can enter opening balances. You can review this screen but not post.
        </p>
      )}

      {blockedByLock && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Accounting is closed through {String(lockedThrough!.month).padStart(2, '0')}/
          {lockedThrough!.year}, so an entry dated {asOfDate} will be rejected. The owner must
          reopen that period first, or you can date the entry after the close.
        </p>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle className="text-base">As-of Date</CardTitle></CardHeader>
          <CardContent>
            <div className="max-w-xs space-y-1.5">
              <Label>Balances are stated as of</Label>
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="tabular-nums" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Party Receivables</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {receivables.map((row, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  {idx === 0 && <Label>Party</Label>}
                  <Combobox
                    options={partyOptions.filter(
                      (o) => o.value === row.party_id || !receivables.some((r) => r.party_id === o.value),
                    )}
                    value={row.party_id}
                    onChange={(v) => setReceivables((c) => c.map((r, i) => (i === idx ? { ...r, party_id: v } : r)))}
                    placeholder="Select party…"
                    searchPlaceholder="Search parties…"
                  />
                </div>
                <div className="w-40 space-y-1.5">
                  {idx === 0 && <Label>Amount owed (Rs)</Label>}
                  <Input
                    type="number"
                    min="0"
                    value={row.amount}
                    onChange={(e) => setReceivables((c) => c.map((r, i) => (i === idx ? { ...r, amount: e.target.value } : r)))}
                    className="text-right tabular-nums"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setReceivables((c) => c.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setReceivables((c) => [...c, { party_id: '', amount: '' }])}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add party
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Cash &amp; Bank</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Cash on hand (1010), Rs</Label>
              <Input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} className="text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Bank balance (1020), Rs</Label>
              <Input type="number" min="0" value={bank} onChange={(e) => setBank(e.target.value)} className="text-right tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Mobile wallet (1030), Rs</Label>
              <Input type="number" min="0" value={wallet} onChange={(e) => setWallet(e.target.value)} className="text-right tabular-nums" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Other Assets &amp; Liabilities (optional)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {others.map((row, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  {idx === 0 && <Label>Account</Label>}
                  <select
                    value={row.account_code}
                    onChange={(e) => setOthers((c) => c.map((r, i) => (i === idx ? { ...r, account_code: e.target.value } : r)))}
                    className={SELECT_CLASS}
                  >
                    <option value="">Select account…</option>
                    {otherAccounts.map((a) => (
                      <option key={a.account_code} value={a.account_code}>
                        {a.account_code} — {a.account_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-32 space-y-1.5">
                  {idx === 0 && <Label>Debit (Rs)</Label>}
                  <Input
                    type="number"
                    min="0"
                    value={row.debit}
                    onChange={(e) => setOthers((c) => c.map((r, i) => (i === idx ? { ...r, debit: e.target.value, credit: e.target.value ? '' : r.credit } : r)))}
                    className="text-right tabular-nums"
                  />
                </div>
                <div className="w-32 space-y-1.5">
                  {idx === 0 && <Label>Credit (Rs)</Label>}
                  <Input
                    type="number"
                    min="0"
                    value={row.credit}
                    onChange={(e) => setOthers((c) => c.map((r, i) => (i === idx ? { ...r, credit: e.target.value, debit: e.target.value ? '' : r.debit } : r)))}
                    className="text-right tabular-nums"
                  />
                </div>
                <div className="w-44 space-y-1.5">
                  {idx === 0 && <Label>Note</Label>}
                  <Input
                    value={row.description}
                    onChange={(e) => setOthers((c) => c.map((r, i) => (i === idx ? { ...r, description: e.target.value } : r)))}
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setOthers((c) => c.filter((_, i) => i !== idx))}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setOthers((c) => [...c, { account_code: '', debit: '', credit: '', description: '' }])}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add line
            </Button>
            <p className="text-xs text-muted-foreground">
              Assets you own (equipment, buildings, deposits) go in Debit; amounts you owe (loans,
              unpaid bills) go in Credit.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 text-sm">
                <p>
                  Total debits <span className="font-semibold tabular-nums">{formatMoney(totals.debit)}</span>
                  {' · '}
                  Total credits <span className="font-semibold tabular-nums">{formatMoney(totals.credit)}</span>
                </p>
                {hasAnything && totals.plug !== 0 && (
                  <p className="text-muted-foreground">
                    Owner&apos;s Capital (3010) will be {totals.plug > 0 ? 'credited' : 'debited'}{' '}
                    <span className="font-semibold tabular-nums">{formatMoney(Math.abs(totals.plug))}</span> to balance the entry.
                  </p>
                )}
              </div>
              <Button onClick={submit} disabled={!canEnter || !hasAnything || submitting}>
                {submitting ? 'Posting…' : 'Post opening balances'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
