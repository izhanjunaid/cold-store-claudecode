'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on Hand' },
  { code: '1020', label: '1020 — Bank Account (Main)' },
  { code: '1030', label: '1030 — Mobile Wallet' },
];

export default function CashTransfersPage() {
  const canPost = useCan('accounting.post_journal');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState('1010');
  const [to, setTo] = useState('1020');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);

  const amountPkr = Number(amount);
  const valid = from !== to && amountPkr > 0 && Number.isFinite(amountPkr);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const submit = async () => {
    setPosting(true);
    try {
      const entry = (await apiClient('/v1/accounting/cash-transfers', {
        method: 'POST',
        body: {
          transfer_date: date,
          from_account_code: from,
          to_account_code: to,
          amount_pkr: amountPkr,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })) as { entry_number: string };
      toast.success(`Transferred ${formatMoney(amountPkr)} — ${entry.entry_number}`);
      setAmount('');
      setNote('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record the transfer');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cash Transfer"
        description="Move money between the facility's own cash, bank and wallet accounts"
      />

      <p className="mb-4 max-w-3xl rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Depositing the day&rsquo;s takings into the bank, or drawing cash out of it, moves money
        between your own pockets — it changes where the money is, not how much there is. That is why
        these do not appear on the cash flow statement, and why the amount transferred is never
        income or expense.
      </p>

      <Card className="max-w-3xl p-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="xfer-date">Date</Label>
            <Input id="xfer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="xfer-amount">Amount (PKR)</Label>
            <Input
              id="xfer-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="xfer-from">From</Label>
            <select id="xfer-from" className={SELECT_CLASS} value={from} onChange={(e) => setFrom(e.target.value)}>
              {ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="xfer-to">To</Label>
            <select id="xfer-to" className={SELECT_CLASS} value={to} onChange={(e) => setTo(e.target.value)}>
              {ACCOUNTS.map((a) => (
                <option key={a.code} value={a.code}>{a.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="xfer-note">Note (optional)</Label>
            <Input
              id="xfer-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. daily takings deposited at branch"
              maxLength={300}
            />
          </div>
        </div>

        {from === to && (
          <p className="mt-3 text-xs text-destructive">
            The source and destination must be different accounts.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={swap}>
            <ArrowRight className="mr-2 h-4 w-4 rotate-180" aria-hidden />
            Swap direction
          </Button>
          {canPost && (
            <Button onClick={submit} disabled={!valid || posting} className="ml-auto">
              {posting ? 'Recording…' : 'Record transfer'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
