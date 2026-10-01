'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, Info } from 'lucide-react';
import { localIsoDate, type OpeningBalanceStatusResponseType } from '@coldchain/shared';
import { apiClient, apiClientList } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Combobox } from '@/components/ui/combobox';
import { EditableRows, FormActions, type EditableRowColumn } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';

interface Party {
  id: string;
  name: string;
  party_type?: string;
}
interface PartyRow {
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
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const amountOf = (s: string) => parseFloat(s) || 0;

export default function OpeningBalancesPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const canEnter = can(user, 'accounting.post_journal');

  const [status, setStatus] = useState<OpeningBalanceStatusResponseType | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // The viewer's own "today", not the UTC date (docs/25 L-39).
  const [asOfDate, setAsOfDate] = useState(() => localIsoDate());
  const [receivables, setReceivables] = useState<PartyRow[]>([]);
  const [payables, setPayables] = useState<PartyRow[]>([]);
  const [cash, setCash] = useState('');
  const [bank, setBank] = useState('');
  const [wallet, setWallet] = useState('');
  const [others, setOthers] = useState<OtherRow[]>([]);
  const [lockedThrough, setLockedThrough] = useState<{ year: number; month: number } | null>(null);

  useEffect(() => {
    Promise.all([
      apiClient<OpeningBalanceStatusResponseType>('/v1/accounting/opening-balances'),
      apiClientList<Party>('/v1/parties?page_size=200&is_active=true').then((r) => r.data),
      // Advisory only — never let it take the screen down with it.
      apiClient<PeriodLock[]>('/v1/accounting/period-locks').catch(() => [] as PeriodLock[]),
    ])
      .then(([st, ps, locks]) => {
        setStatus(st);
        setParties(ps);
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

  // Suppliers are owed money; everyone else owes it. The server checks each
  // party's own control account either way.
  const customerOptions = useMemo(
    () => parties.filter((p) => p.party_type !== 'SUPPLIER').map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  const supplierOptions = useMemo(
    () => parties.filter((p) => p.party_type === 'SUPPLIER').map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  // The server decides which accounts an "other" line may use, from the chart's
  // own flags, and serves the list (docs/25 L-26).
  const otherAccounts = status?.other_line_accounts ?? [];
  const otherByCode = useMemo(() => new Map(otherAccounts.map((a) => [a.account_code, a])), [otherAccounts]);

  const totals = useMemo(() => {
    let debit = amountOf(cash) + amountOf(bank) + amountOf(wallet);
    let credit = 0;
    for (const r of receivables) debit += amountOf(r.amount);
    for (const p of payables) credit += amountOf(p.amount);
    for (const o of others) {
      debit += amountOf(o.debit);
      credit += amountOf(o.credit);
    }
    // A preview only: the server books the difference itself.
    return { debit, credit, difference: Math.round((debit - credit) * 100) / 100 };
  }, [receivables, payables, cash, bank, wallet, others]);

  // Opening balances are backdated by nature, and the period lock is asserted
  // against a closed-through watermark. Say so before the form is filled in.
  const blockedByLock =
    lockedThrough !== null &&
    (() => {
      const [y, m] = asOfDate.split('-').map(Number);
      if (!y || !m) return false;
      return y < lockedThrough.year || (y === lockedThrough.year && m <= lockedThrough.month);
    })();

  const hasAnything = totals.debit > 0 || totals.credit > 0;

  // A date after the first posting is impossible; the entry is immutable once
  // posted, so finding out afterwards costs a reversal.
  const blockedByActivity =
    status?.earliest_posting_date !== null &&
    status?.earliest_posting_date !== undefined &&
    status.earliest_posting_date < asOfDate;

  // A fixed asset's cost (a debit-normal non-current asset) opened here is a
  // balance only: the register needs it too, without posting it a second time.
  const opensFixedAssets = others.some((o) => {
    const a = otherByCode.get(o.account_code);
    return a?.statement_section === 'NON_CURRENT_ASSET' && a.normal_balance === 'DEBIT' && amountOf(o.debit) > 0;
  });

  const partyColumns = (
    rows: PartyRow[],
    options: { value: string; label: string }[],
    amountHeader: string,
  ): EditableRowColumn<PartyRow>[] => [
    {
      key: 'party',
      header: 'Party',
      width: '2fr',
      render: (row, update) => (
        <Combobox
          options={options.filter((o) => o.value === row.party_id || !rows.some((r) => r.party_id === o.value))}
          value={row.party_id}
          onChange={(v) => update({ party_id: v })}
          placeholder="Select party…"
          searchPlaceholder="Search parties…"
        />
      ),
    },
    {
      key: 'amount',
      header: amountHeader,
      width: '160px',
      align: 'right',
      render: (row, update) => (
        <Input type="number" min="0" value={row.amount} onChange={(e) => update({ amount: e.target.value })} className="text-right tabular-nums" />
      ),
    },
  ];

  const otherColumns: EditableRowColumn<OtherRow>[] = [
    {
      key: 'account',
      header: 'Account',
      width: '2fr',
      render: (row, update) => (
        <select value={row.account_code} onChange={(e) => update({ account_code: e.target.value })} className={SELECT_CLASS}>
          <option value="">Select account…</option>
          {otherAccounts.map((a) => (
            <option key={a.account_code} value={a.account_code}>
              {a.account_code} — {a.account_name}
            </option>
          ))}
        </select>
      ),
    },
    {
      key: 'debit',
      header: 'Debit (Rs)',
      width: '130px',
      align: 'right',
      render: (row, update) => (
        <Input type="number" min="0" value={row.debit} onChange={(e) => update({ debit: e.target.value, credit: e.target.value ? '' : row.credit })} className="text-right tabular-nums" />
      ),
    },
    {
      key: 'credit',
      header: 'Credit (Rs)',
      width: '130px',
      align: 'right',
      render: (row, update) => (
        <Input type="number" min="0" value={row.credit} onChange={(e) => update({ credit: e.target.value, debit: e.target.value ? '' : row.debit })} className="text-right tabular-nums" />
      ),
    },
    {
      key: 'note',
      header: 'Note',
      width: '1fr',
      render: (row, update) => (
        <Input value={row.description} onChange={(e) => update({ description: e.target.value })} />
      ),
    },
  ];

  const partyBody = (rows: PartyRow[]) =>
    rows.filter((r) => r.party_id && amountOf(r.amount) > 0).map((r) => ({ party_id: r.party_id, amount_pkr: amountOf(r.amount) }));

  const submit = async () => {
    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string; entry_number: string }>(
        '/v1/accounting/opening-balances',
        {
          method: 'POST',
          body: {
            as_of_date: asOfDate,
            party_receivables: partyBody(receivables),
            party_payables: partyBody(payables),
            cash_pkr: amountOf(cash),
            bank_pkr: amountOf(bank),
            wallet_pkr: amountOf(wallet),
            other_lines: others
              .filter((o) => o.account_code && (amountOf(o.debit) > 0 || amountOf(o.credit) > 0))
              .map((o) => ({
                account_code: o.account_code,
                debit_pkr: amountOf(o.debit),
                credit_pkr: amountOf(o.credit),
                description: o.description.trim() || undefined,
              })),
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
                {/* The residual reads on the balance sheet as equity while
                    belonging to nobody; this is where someone who already
                    entered their balances is told. */}
                {status.unattributed_plug_pkr !== 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <span className="font-semibold tabular-nums">
                      {formatMoney(Math.abs(status.unattributed_plug_pkr))}
                    </span>{' '}
                    of opening equity is still in Opening Balance Equity, which belongs to no owner.
                    Attribute it to each owner on the{' '}
                    <Link className="underline" href="/accounting/partners">
                      Owners
                    </Link>{' '}
                    page, in whatever split they agree.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl pb-16">
      <PageHeader
        title="Opening Balances"
        crumb="Opening Balances"
        description="Bring balances from your paper registers into the system — one balanced entry, done once at go-live"
      />

      <div className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Enter what each party owes you, what you owe each supplier, your cash, bank and wallet
          balances, and any other assets or liabilities as of the day before you started using
          ColdChain. Add an <strong>other line</strong> for each owner&apos;s capital account, and
          put profits earned before the cutover to Retained Earnings. Anything left over lands in
          Opening Balance Equity, which belongs to no owner — so aim to leave nothing there.
          Outstanding peshgi is not entered here — issue it through the Loans module so recovery
          tracking works.
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

      {blockedByActivity && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {status!.earliest_posting_entry_number} is already posted on{' '}
          {status!.earliest_posting_date}, before the {asOfDate} you have chosen. Opening balances
          are the position you started from, so they must be dated on or before your first entry.
        </p>
      )}

      {opensFixedAssets && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Assets you already owned are recorded here as balances only. Then add each one under{' '}
          <Link className="underline" href="/accounting/fixed-assets/opening">
            Fixed Assets → Assets owned at go-live
          </Link>{' '}
          with its depreciation to date — that adds it to the register without posting it again,
          and the screen shows any difference.
        </p>
      )}

      <div className="space-y-4">
        <Card>
          <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-4">
            <div className="space-y-1">
              <Label>Balances stated as of</Label>
              <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label>Cash on hand, Rs</Label>
              <Input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} className="text-right tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label>Main bank account, Rs</Label>
              <Input type="number" min="0" value={bank} onChange={(e) => setBank(e.target.value)} className="text-right tabular-nums" />
            </div>
            <div className="space-y-1">
              <Label>Mobile wallet, Rs</Label>
              <Input type="number" min="0" value={wallet} onChange={(e) => setWallet(e.target.value)} className="text-right tabular-nums" />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">Owed to you — party receivables</h2>
          <EditableRows
            rows={receivables}
            onChange={setReceivables}
            columns={partyColumns(receivables, customerOptions, 'Amount owed (Rs)')}
            newRow={() => ({ party_id: '', amount: '' })}
            addLabel="Add party"
          />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">You owe — supplier payables</h2>
          <EditableRows
            rows={payables}
            onChange={setPayables}
            columns={partyColumns(payables, supplierOptions, 'Amount you owe (Rs)')}
            newRow={() => ({ party_id: '', amount: '' })}
            addLabel="Add supplier"
          />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-sm font-semibold">Other Assets, Liabilities &amp; Equity (optional)</h2>
          <EditableRows
            rows={others}
            onChange={setOthers}
            columns={otherColumns}
            newRow={() => ({ account_code: '', debit: '', credit: '', description: '' })}
            addLabel="Add line"
            footer={
              <p className="text-2xs text-muted-foreground">
                Assets you own go in Debit; amounts you owe, and owners&apos; capital, go in Credit.
              </p>
            }
          />
        </div>
      </div>

      <FormActions
        meta={
          <div className="text-sm">
            <span>
              Total debits <span className="font-semibold tabular-nums">{formatMoney(totals.debit)}</span>
              {' · '}
              Total credits <span className="font-semibold tabular-nums">{formatMoney(totals.credit)}</span>
            </span>
            {hasAnything && totals.difference !== 0 && (
              <span className="ml-3 text-amber-700 dark:text-amber-400">
                Not yet attributed to an owner{' '}
                <span className="font-semibold tabular-nums">{formatMoney(Math.abs(totals.difference))}</span>
              </span>
            )}
          </div>
        }
      >
        <Button onClick={submit} disabled={!canEnter || !hasAnything || submitting}>
          {submitting ? 'Posting…' : 'Post opening balances'}
        </Button>
      </FormActions>
    </div>
  );
}
