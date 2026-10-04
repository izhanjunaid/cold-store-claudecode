'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { formatDate, formatMoney } from '@/lib/format';
import { VoidDocumentDialog } from '../payables/void-document-dialog';

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface CashTransfer {
  id: string;
  transfer_date: string;
  from_account_name: string;
  to_account_name: string;
  amount_pkr: number;
  notes: string | null;
  entry_number: string | null;
  voided_at: string | null;
  void_reason: string | null;
  allowed_actions: Array<'void'>;
}

export default function CashTransfersPage() {
  const canPost = useCan('accounting.post_journal');
  const queryClient = useQueryClient();
  // Every cash equivalent on the chart — an owner's second bank included, cheques in hand never.
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);

  const [date, setDate] = useState(() => localIsoDate(new Date()));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [voidTarget, setVoidTarget] = useState<CashTransfer | null>(null);

  useEffect(() => {
    if (!from && cashAccounts[0]) setFrom(cashAccounts[0].account_code);
    if (!to && cashAccounts[1]) setTo(cashAccounts[1].account_code);
  }, [cashAccounts, from, to]);

  const { state, setPage, setPerPage, setSort } = useTableState([] as const);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage }), [state]);
  const { data, isLoading, isError } = useListQuery<CashTransfer>(
    qk.accounting.list('cash-transfers', params),
    '/v1/accounting/cash-transfers',
    params,
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.accounting.all });

  const amountPkr = Number(amount);
  const valid = !!from && !!to && from !== to && amountPkr > 0 && Number.isFinite(amountPkr);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  const submit = async () => {
    setPosting(true);
    try {
      const transfer = (await apiClient('/v1/accounting/cash-transfers', {
        method: 'POST',
        body: {
          transfer_date: date,
          from_account_code: from,
          to_account_code: to,
          amount_pkr: amountPkr,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      })) as CashTransfer;
      toast.success(`Transferred ${formatMoney(amountPkr)} — ${transfer.entry_number}`);
      setAmount('');
      setNote('');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record the transfer');
    } finally {
      setPosting(false);
    }
  };

  const columns: DataTableColumn<CashTransfer>[] = [
    { id: 'date', header: 'Date', cell: (t) => formatDate(t.transfer_date), csv: (t) => t.transfer_date },
    { id: 'from', header: 'From', cell: (t) => t.from_account_name, csv: (t) => t.from_account_name },
    { id: 'to', header: 'To', cell: (t) => t.to_account_name, csv: (t) => t.to_account_name },
    { id: 'amount', header: 'Amount', numeric: true, cell: (t) => formatMoney(t.amount_pkr), csv: (t) => t.amount_pkr },
    { id: 'note', header: 'Note', cell: (t) => t.notes ?? '—', csv: (t) => t.notes ?? '' },
    { id: 'entry', header: 'Entry', cell: (t) => <span className="font-mono">{t.entry_number ?? '—'}</span>, csv: (t) => t.entry_number ?? '' },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => (t.voided_at ? <StatusBadge status="VOID" /> : <StatusBadge status="POSTED" />),
      csv: (t) => (t.voided_at ? `VOID: ${t.void_reason ?? ''}` : 'POSTED'),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: (t) =>
        canPost && t.allowed_actions.includes('void') ? (
          <Button size="sm" variant="outline" onClick={() => setVoidTarget(t)}>
            Void
          </Button>
        ) : null,
    },
  ];

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

      {canPost && (
        <Card className="mb-6 max-w-3xl p-3">
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
                {cashAccounts.map((a) => (
                  <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="xfer-to">To</Label>
              <select id="xfer-to" className={SELECT_CLASS} value={to} onChange={(e) => setTo(e.target.value)}>
                {cashAccounts.map((a) => (
                  <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
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

          {from && from === to && (
            <p className="mt-3 text-xs text-destructive">The source and destination must be different accounts.</p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <Button type="button" variant="outline" onClick={swap}>
              <ArrowRight className="mr-2 h-4 w-4 rotate-180" aria-hidden />
              Swap direction
            </Button>
            <Button onClick={submit} disabled={!valid || posting} className="ml-auto">
              {posting ? 'Recording…' : 'Record transfer'}
            </Button>
          </div>
        </Card>
      )}

      <h2 className="mb-2 text-sm font-semibold">Transfer history</h2>
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        meta={data?.meta}
        isLoading={isLoading}
        isError={isError}
        sort={state.sort}
        onSortChange={setSort}
        page={state.page}
        perPage={state.perPage}
        onPageChange={setPage}
        onPerPageChange={setPerPage}
        getRowId={(t) => t.id}
        csvFilename="cash-transfers"
        emptyState={{ title: 'No transfers yet' }}
      />

      <VoidDocumentDialog
        title="Void transfer"
        explanation="For a transfer recorded in error: its entry is reversed and the transfer stays on the list, marked void."
        url={voidTarget ? `/v1/accounting/cash-transfers/${voidTarget.id}/void` : null}
        open={voidTarget !== null}
        onOpenChange={(o) => !o && setVoidTarget(null)}
        onVoided={refresh}
      />
    </div>
  );
}
