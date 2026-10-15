'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Truck } from 'lucide-react';
import { addDays, localIsoDate } from '@coldchain/shared';
import { apiClient, apiClientList } from '@/lib/api-client';
import { can } from '@/lib/permissions';
import { qk } from '@/lib/query-keys';
import { formatMoney } from '@/lib/format';
import { useAuthStore } from '@/stores/auth.store';
import { useListQuery } from '@/hooks/use-list-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/layout/page-header';
import { WithdrawSheet } from '@/components/outbound/withdraw-sheet';
import { CheckoutSheet, type CheckoutResult } from '@/components/dispatch/checkout-sheet';
import { openDispatchNotePdf } from '@/components/dispatch/dispatch-pdf';
import { openInvoicePdf } from '@/components/billing/invoice-pdf';

type Stage = 'BOOKED' | 'WEIGHED' | 'DISPATCHED' | 'PAID' | 'LEFT' | 'CANCELLED';

interface DispatchRow {
  id: string;
  dispatch_note_number: string | null;
  status: string;
  stage: Stage;
  lot_id: string;
  lot_number: string;
  marka: string | null;
  owner_party_name: string | null;
  quantity_withdrawn_bags: number;
  vehicle_number: string | null;
  invoice: { id: string; invoice_number: string | null; status: string; total_pkr: number; balance_due_pkr: number } | null;
}

interface LotHit {
  id: string;
  lot_number: string;
  owner_party_name: string | null;
  marka: string | null;
  commodity_name: string | null;
  current_balance_bags: number;
  status: string;
}

interface GatePassLite {
  vehicle_number: string;
}

const STAGE_LABEL: Record<Stage, { text: string; tone: 'info' | 'warning' | 'danger' | 'success' | 'muted' }> = {
  BOOKED: { text: 'Booked — weigh it', tone: 'info' },
  WEIGHED: { text: 'Weighed', tone: 'warning' },
  DISPATCHED: { text: 'Dispatched', tone: 'danger' },
  PAID: { text: 'Paid — ready to leave', tone: 'success' },
  LEFT: { text: 'Left', tone: 'muted' },
  CANCELLED: { text: 'Cancelled', tone: 'muted' },
};

/** One tap per step: the queue shows what has been booked and the next thing to do on each. */
export default function DispatchDeskPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const canUse = !user || can(user, 'outbound.record');
  const canDispatch = can(user, 'outbound.finalize') && can(user, 'invoices.manage');

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [bookLot, setBookLot] = useState<LotHit | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Lots to withdraw from: the same search the command palette uses.
  const { data: lotHits = [] } = useQuery({
    queryKey: ['dispatch', 'lot-search', debounced],
    queryFn: async () =>
      (await apiClientList<LotHit>(`/v1/lots?search=${encodeURIComponent(debounced)}&status=ACTIVE&per_page=8`)).data,
    enabled: canUse && debounced.length >= 2,
  });

  // Trucks inside: their plates are one tap away when booking, so the gate matches them exactly.
  const { data: inside = [] } = useQuery({
    queryKey: ['dispatch', 'trucks-inside'],
    queryFn: async () => {
      try {
        return (await apiClientList<GatePassLite>('/v1/gate-passes?active=true&page_size=50')).data;
      } catch {
        return []; // not everyone who books holds the gate permission
      }
    },
    enabled: canUse,
    refetchInterval: 15_000,
  });
  const plates = [...new Set(inside.map((p) => p.vehicle_number))];

  const params = {
    status: 'PENDING,WEIGHED,DISPATCHED',
    date_from: addDays(localIsoDate(), -2),
    page_size: 50,
  };
  const { data, isLoading } = useListQuery<DispatchRow>(qk.outbound.list(params), '/v1/outbound-events', params, {
    enabled: canUse,
    refetchInterval: 15_000,
  });
  const rows = (data?.data ?? []).filter((r) => r.stage !== 'LEFT' && r.stage !== 'CANCELLED');

  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.outbound.all });

  async function afterCheckout(result: CheckoutResult) {
    if (result.payment?.receipt_number) toast.message(`Receipt ${result.payment.receipt_number}`);
    try {
      await openDispatchNotePdf(result.outbound.id);
    } catch {
      /* the row's Print button is the fallback */
    }
    refresh();
  }

  if (!canUse) {
    return (
      <div>
        <PageHeader title="Dispatch Desk" />
        <p className="text-muted-foreground">You don&apos;t have permission to book dispatches.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Dispatch Desk" description="Book, weigh, dispatch and collect — one screen per truck" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New withdrawal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Lot #, marka, party or vehicle…"
              aria-label="Find a lot"
              className="h-11 pl-9 text-base"
            />
          </div>
          {debounced.length >= 2 && lotHits.length === 0 && (
            <p className="text-sm text-muted-foreground">No active lot matches “{debounced}”.</p>
          )}
          {lotHits.length > 0 && (
            <ul className="max-w-xl divide-y rounded-md border">
              {lotHits.map((lot) => (
                <li key={lot.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                    onClick={() => setBookLot(lot)}
                  >
                    <span className="font-mono font-medium">{lot.lot_number}</span>
                    <span className="truncate">{lot.owner_party_name ?? '—'}</span>
                    {lot.marka && <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">{lot.marka}</span>}
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {lot.current_balance_bags.toLocaleString()} bags
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today&apos;s dispatches</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={Truck} title="Nothing waiting" hint="Booked withdrawals appear here until the truck has left." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="h-8">
                  <TableHead>Dispatch note</TableHead>
                  <TableHead>Lot / owner</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead className="text-right">Bags</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Next</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <DispatchRowView
                    key={row.id}
                    row={row}
                    canDispatch={canDispatch}
                    onChanged={refresh}
                    onCollect={() => setCheckoutId(row.id)}
                    onOpen={() => router.push(`/outbound-events/${row.id}`)}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {bookLot && (
        <WithdrawSheet
          open
          onOpenChange={(o) => !o && setBookLot(null)}
          lotId={bookLot.id}
          lotNumber={bookLot.lot_number}
          plateSuggestions={plates}
          onBooked={() => {
            setBookLot(null);
            setSearch('');
            refresh();
          }}
        />
      )}
      {checkoutId && (
        <CheckoutSheet
          open
          onOpenChange={(o) => !o && setCheckoutId(null)}
          outboundId={checkoutId}
          onDone={afterCheckout}
        />
      )}
    </div>
  );
}

function DispatchRowView({
  row,
  canDispatch,
  onChanged,
  onCollect,
  onOpen,
}: {
  row: DispatchRow;
  canDispatch: boolean;
  onChanged: () => void;
  onCollect: () => void;
  onOpen: () => void;
}) {
  const router = useRouter();
  const [weight, setWeight] = useState('');
  const [saving, setSaving] = useState(false);
  const label = STAGE_LABEL[row.stage];

  async function weigh() {
    const kg = Number(weight);
    if (!kg || kg <= 0) return toast.error('Enter the weight on the kanta, in kg');
    setSaving(true);
    try {
      await apiClient(`/v1/outbound-events/${row.id}/weight`, { method: 'PATCH', body: { outbound_weight_kg: kg } });
      toast.success('Weight recorded');
      setWeight('');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the weight');
    } finally {
      setSaving(false);
    }
  }

  async function print() {
    try {
      await openDispatchNotePdf(row.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the dispatch note');
    }
  }

  return (
    <TableRow className="h-9">
      <TableCell className="py-1 font-mono text-xs">{row.dispatch_note_number ?? '—'}</TableCell>
      <TableCell className="py-1 text-sm">
        <button type="button" className="font-mono text-primary-700 hover:underline" onClick={() => router.push(`/lots/${row.lot_id}`)}>
          {row.lot_number}
        </button>
        <span className="ml-2 text-muted-foreground">{row.owner_party_name ?? '—'}</span>
        {row.marka && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold">{row.marka}</span>}
      </TableCell>
      <TableCell className="py-1 font-mono text-sm">{row.vehicle_number ?? '—'}</TableCell>
      <TableCell className="py-1 text-right tabular-nums">{row.quantity_withdrawn_bags.toLocaleString()}</TableCell>
      <TableCell className="py-1">
        <StatusBadge status={label.text} tone={label.tone} raw />
        {row.stage === 'DISPATCHED' && row.invoice && (
          <span className="ml-2 text-xs text-muted-foreground">owes {formatMoney(row.invoice.balance_due_pkr)}</span>
        )}
      </TableCell>
      <TableCell className="py-1">
        <div className="flex items-center justify-end gap-1">
          {row.stage === 'BOOKED' && (
            <>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="kg"
                aria-label={`Weight in kg for ${row.dispatch_note_number ?? row.lot_number}`}
                className="h-7 w-24 text-right tabular-nums"
              />
              <Button size="sm" onClick={weigh} disabled={saving}>
                Weigh
              </Button>
            </>
          )}
          {row.stage === 'WEIGHED' &&
            (canDispatch ? (
              <Button size="sm" onClick={onCollect}>
                Dispatch &amp; Collect
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">Waiting for a manager</span>
            ))}
          {(row.stage === 'DISPATCHED' || row.stage === 'PAID') && (
            <>
              <Button size="sm" variant="outline" onClick={print}>
                Print DN
              </Button>
              {row.invoice && (
                <Button size="sm" variant="ghost" onClick={() => openInvoicePdf(row.invoice!.id).catch(() => toast.error('Could not load the invoice'))}>
                  Invoice
                </Button>
              )}
            </>
          )}
          <Button size="sm" variant="ghost" onClick={onOpen}>
            Details
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
