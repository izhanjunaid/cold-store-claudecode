'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { localIsoDate, type OwnerEquityMovementResponseType, type PartnerResponseType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { useAccounts } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';

/**
 * Money an owner puts in, or takes out — recorded as a document against the
 * owner, never as a bare journal entry against an account someone picked
 * (docs/25 L-23).
 *
 * This screen exists so the correct path is the easy one. An owner's monthly
 * amount is not a salary and does not belong in payroll: a member of an
 * association of persons cannot be its employee, so what they take is a share of
 * profit rather than a cost of earning it.
 */

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function OwnerEquityPage() {
  const canPost = useCan('accounting.post_journal');
  const { data: accounts } = useAccounts();

  const [partners, setPartners] = useState<PartnerResponseType[]>([]);
  const [movements, setMovements] = useState<OwnerEquityMovementResponseType[]>([]);
  const [date, setDate] = useState(() => localIsoDate());
  const [direction, setDirection] = useState<'DRAWING' | 'CAPITAL_IN'>('DRAWING');
  const [partnerId, setPartnerId] = useState('');
  const [cashCode, setCashCode] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [voiding, setVoiding] = useState<OwnerEquityMovementResponseType | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    const [ps, ms] = await Promise.all([
      apiClient<PartnerResponseType[]>('/v1/partners'),
      apiClient<OwnerEquityMovementResponseType[]>('/v1/accounting/owner-equity'),
    ]);
    setPartners(ps);
    setMovements(ms);
  }, []);

  useEffect(() => {
    load().catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load'));
  }, [load]);

  // Only what the chart marks as cash: an owner's second bank account is
  // offered, cheques in hand (which can still bounce) are not.
  const cashAccounts = (accounts ?? []).filter((a) => a.is_cash_equivalent);
  const owners = partners.filter((p) => !p.retired_on || p.retired_on >= date);
  const owner = partners.find((p) => p.id === partnerId);
  const isDrawing = direction === 'DRAWING';

  const amountPkr = Number(amount);
  const valid = !!partnerId && !!cashCode && amountPkr > 0 && Number.isFinite(amountPkr);

  const submit = async () => {
    setPosting(true);
    try {
      const entry = await apiClient<{ entry_number: string }>('/v1/accounting/owner-equity', {
        method: 'POST',
        body: {
          partner_id: partnerId,
          movement_date: date,
          direction,
          cash_account_code: cashCode,
          amount_pkr: amountPkr,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      toast.success(`${isDrawing ? 'Withdrawal' : 'Capital'} of ${formatMoney(amountPkr)} recorded — ${entry.entry_number}`);
      setAmount('');
      setNote('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record it');
    } finally {
      setPosting(false);
    }
  };

  const confirmVoid = async () => {
    if (!voiding) return;
    setPosting(true);
    try {
      await apiClient(`/v1/accounting/owner-equity/${voiding.id}/void`, {
        method: 'POST',
        body: { reason: voidReason.trim(), date: localIsoDate() },
      });
      toast.success('Voided — its entry is reversed');
      setVoiding(null);
      setVoidReason('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not void it');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Owner Capital &amp; Drawings" description="Money an owner puts into the business, or takes out of it" />

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
              onClick={() => setDirection(value)}
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
            <Label htmlFor="oe-owner">Owner</Label>
            <select id="oe-owner" className={SELECT_CLASS} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Select the owner…</option>
              {owners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {owners.length === 0 ? (
              <p className="text-xs text-destructive">
                No owners recorded yet. Add them under{' '}
                <Link className="underline" href="/accounting/partners">
                  Owners
                </Link>{' '}
                — each gets their own capital and drawings accounts.
              </p>
            ) : (
              owner && (
                <p className="text-xs text-muted-foreground">
                  Posts to {isDrawing ? owner.drawings_account_name : owner.capital_account_name}.
                </p>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="oe-cash">{isDrawing ? 'Paid from' : 'Received into'}</Label>
            <select id="oe-cash" className={SELECT_CLASS} value={cashCode} onChange={(e) => setCashCode(e.target.value)}>
              <option value="">Select account…</option>
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
            <Input id="oe-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular-nums" />
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
          {!canPost && <span className="text-xs text-muted-foreground">You do not have permission to post entries.</span>}
        </div>
      </Card>

      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
        A regular monthly amount and an extra sum taken out of profits are the same thing here — both
        reduce that owner&apos;s stake in the business, and only the note tells them apart. Neither is a
        business cost, so neither changes the profit figure. This is why owners do not go through
        payroll: an owner cannot be an employee of their own firm, and tax law does not allow their pay
        as a deduction.
      </p>

      {movements.length > 0 && (
        <Card className="mt-6 max-w-4xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Movement</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={m.id} className={m.voided_at ? 'text-muted-foreground line-through' : undefined}>
                  <TableCell>{formatDate(m.movement_date)}</TableCell>
                  <TableCell>{m.partner_name}</TableCell>
                  <TableCell>{m.direction === 'DRAWING' ? 'Took out' : 'Put in'}{m.note ? ` — ${m.note}` : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(m.amount_pkr)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {m.journal_entry_id && <Link href={`/accounting/journal-entries/${m.journal_entry_id}`}>{m.entry_number}</Link>}
                  </TableCell>
                  <TableCell className="text-right">
                    {m.voided_at ? (
                      <span className="text-xs no-underline">voided</span>
                    ) : (
                      canPost && (
                        <Button variant="ghost" size="sm" onClick={() => setVoiding(m)}>
                          Void
                        </Button>
                      )
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={voiding !== null} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this movement</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Its entry is reversed today; the original stays on the record with the reason.
          </p>
          <div className="space-y-1">
            <Label htmlFor="oe-void-reason">Reason</Label>
            <Input id="oe-void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(null)}>
              Cancel
            </Button>
            <Button onClick={confirmVoid} disabled={posting || !voidReason.trim()}>
              Void
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
