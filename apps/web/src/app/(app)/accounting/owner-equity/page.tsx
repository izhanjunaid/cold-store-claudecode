'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { useAccounts } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

/**
 * Money an owner puts in, or takes out.
 *
 * This screen exists so the correct path is the easy one. An owner's monthly
 * amount is not a salary and does not belong in payroll: a member of an
 * association of persons cannot be its employee, so what they take is a share
 * of profit rather than a cost of earning it. Recording it as pay would
 * understate profit, every margin on the P&L, and taxable income at once.
 */

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

// Worked out by the statements rather than posted to.
const DERIVED = new Set(['3020', '3030']);

/**
 * The opening-balance plug (opening-balance.service.ts) — 3010 Opening Balance
 * Equity. Excluded from this list outright: it is not an owner, and posting a
 * drawing or a contribution against it would put the movement somewhere nobody
 * owns.
 *
 * It used to be offered here with an "(opening balances)" label instead, because
 * it doubled as a sole proprietor's capital account and hiding it would have left
 * that facility with an empty picker. Every owner now has a named account under
 * 3100, so the label — a warning standing in for a barrier — is no longer the
 * best available answer. Where the picker IS empty, the screen now says what to
 * create rather than offering the wrong thing.
 */
const PLUG = '3010';

export default function OwnerEquityPage() {
  const canPost = useCan('accounting.post_journal');
  const { data: accounts } = useAccounts();

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<'DRAWING' | 'CAPITAL_IN'>('DRAWING');
  const [equityCode, setEquityCode] = useState('');
  const [cashCode, setCashCode] = useState('1020');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  const equityAccounts = (accounts ?? []).filter(
    (a) => a.account_class === 'EQUITY' && !DERIVED.has(a.account_code) && a.account_code !== PLUG,
  );
  const cashAccounts = (accounts ?? []).filter((a) => a.parent_account_code === '1000');

  const amountPkr = Number(amount);
  const valid = !!equityCode && !!cashCode && amountPkr > 0 && Number.isFinite(amountPkr);
  const isDrawing = direction === 'DRAWING';

  const submit = async () => {
    setPosting(true);
    try {
      const entry = (await apiClient('/v1/accounting/owner-equity', {
        method: 'POST',
        body: {
          movement_date: date,
          direction,
          equity_account_code: equityCode,
          cash_account_code: cashCode,
          amount_pkr: amountPkr,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })) as { entry_number: string };
      toast.success(
        `${isDrawing ? 'Withdrawal' : 'Capital'} of ${formatMoney(amountPkr)} recorded — ${entry.entry_number}`,
      );
      setAmount('');
      setNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record it');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Owner Capital &amp; Drawings"
        description="Money an owner puts into the business, or takes out of it"
      />

      <Card className="max-w-2xl p-4">
        <div className="mb-4 flex gap-1 rounded-md bg-muted p-1">
          {(
            [
              ['DRAWING', 'Owner takes money out'],
              ['CAPITAL_IN', 'Owner puts money in'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setDirection(value);
                setEquityCode('');
              }}
              className={`flex-1 rounded px-3 py-1.5 text-sm ${
                direction === value ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="oe-account">
              {isDrawing ? "Owner's drawings account" : "Owner's capital account"}
            </Label>
            <select
              id="oe-account"
              className={SELECT_CLASS}
              value={equityCode}
              onChange={(e) => setEquityCode(e.target.value)}
            >
              <option value="">Select the owner…</option>
              {equityAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
            {equityAccounts.length === 0 ? (
              // Nothing to offer is a real state now that the plug is excluded,
              // and it has a specific remedy — so name it rather than leaving an
              // empty dropdown to be puzzled over.
              <p className="text-xs text-destructive">
                No owner accounts exist yet. Add one per owner under Chart of Accounts —
                capital under <span className="font-mono">3100</span>, drawings under{' '}
                <span className="font-mono">3200</span>.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Each owner has their own, capital under <span className="font-mono">3100</span> and
                drawings under <span className="font-mono">3200</span>. Add one under Chart of
                Accounts if it is missing.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oe-cash">{isDrawing ? 'Paid from' : 'Received into'}</Label>
            <select
              id="oe-cash"
              className={SELECT_CLASS}
              value={cashCode}
              onChange={(e) => setCashCode(e.target.value)}
            >
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>
                  {a.account_code} — {a.account_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oe-date">Date</Label>
            <Input id="oe-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oe-amount">Amount (PKR)</Label>
            <Input
              id="oe-amount"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="tabular-nums"
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="oe-note">Note</Label>
            <Input
              id="oe-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isDrawing ? 'e.g. March monthly amount' : 'e.g. funds for new chiller'}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={submit} disabled={!valid || posting || !canPost}>
            {posting ? 'Recording…' : isDrawing ? 'Record withdrawal' : 'Record capital'}
          </Button>
          {!canPost && (
            <span className="text-xs text-muted-foreground">
              You do not have permission to post entries.
            </span>
          )}
        </div>
      </Card>

      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        A regular monthly amount and an extra sum taken out of profits are the same thing here —
        both reduce that owner&apos;s stake in the business, and only the note tells them apart.
        Neither is a business cost, so neither changes the profit figure. This is why owners do not
        go through payroll: an owner cannot be an employee of their own firm, and tax law does not
        allow their pay as a deduction.
      </p>
    </div>
  );
}
