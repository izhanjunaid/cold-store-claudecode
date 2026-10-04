'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MONTH_NAMES_SHORT, localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { useListQuery } from '@/hooks/use-list-query';
import { qk } from '@/lib/query-keys';
import { periodToSettle } from '@/lib/tax-period';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable, useTableState, type DataTableColumn } from '@/components/data-table';
import { formatDate, formatMoney } from '@/lib/format';
import { VoidDocumentDialog } from '../void-document-dialog';

const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface Outstanding {
  account_code: string;
  account_name: string;
  outstanding_pkr: number;
}

interface Remittance {
  id: string;
  liability_account_name: string;
  period_year: number;
  period_month: number;
  remittance_date: string;
  amount_pkr: number;
  paid_from_account_name: string;
  challan_number: string | null;
  entry_number: string | null;
  voided_at: string | null;
  void_reason: string | null;
  allowed_actions: Array<'void'>;
}

/**
 * Statutory remittances (docs/25 C-10): EOBI, salary tax and the tax withheld from
 * suppliers and landlords, each paid over for a period from one screen. The amount is
 * what the ledger says is owed at the period end — the server computes it.
 */
export default function TaxRemittancesPage() {
  const canRemit = useCan('payroll.remit');
  const queryClient = useQueryClient();
  const settle = periodToSettle(localIsoDate());
  const [year, setYear] = useState(settle.year);
  const [month, setMonth] = useState(settle.month);
  const [payTarget, setPayTarget] = useState<Outstanding | null>(null);
  const [voidTarget, setVoidTarget] = useState<Remittance | null>(null);

  const outstanding = useQuery({
    queryKey: ['accounting', 'tax-remittances-outstanding', year, month],
    queryFn: () =>
      apiClient<Outstanding[]>(`/v1/accounting/tax-remittances/outstanding?period_year=${year}&period_month=${month}`),
  });

  const { state, setPage, setPerPage, setSort } = useTableState([]);
  const params = useMemo(() => ({ page: state.page, page_size: state.perPage }), [state]);
  const history = useListQuery<Remittance>(qk.accounting.list('tax-remittances', params), '/v1/accounting/tax-remittances', params);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounting'] });

  const columns: DataTableColumn<Remittance>[] = [
    { id: 'date', header: 'Paid on', cell: (r) => formatDate(r.remittance_date), csv: (r) => r.remittance_date },
    { id: 'liability', header: 'Paid over', cell: (r) => r.liability_account_name, csv: (r) => r.liability_account_name },
    {
      id: 'period',
      header: 'Period',
      cell: (r) => `${MONTH_NAMES_SHORT[r.period_month - 1]} ${r.period_year}`,
      csv: (r) => `${r.period_year}-${String(r.period_month).padStart(2, '0')}`,
    },
    { id: 'amount', header: 'Amount', numeric: true, cell: (r) => formatMoney(r.amount_pkr), csv: (r) => r.amount_pkr },
    { id: 'from', header: 'Paid from', cell: (r) => r.paid_from_account_name, csv: (r) => r.paid_from_account_name },
    { id: 'challan', header: 'Challan / CPR', cell: (r) => r.challan_number ?? '—', csv: (r) => r.challan_number ?? '' },
    { id: 'entry', header: 'Entry', cell: (r) => <span className="font-mono">{r.entry_number ?? '—'}</span>, csv: (r) => r.entry_number ?? '' },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusBadge status={r.voided_at ? 'VOID' : 'POSTED'} />,
      csv: (r) => (r.voided_at ? `VOID: ${r.void_reason ?? ''}` : 'POSTED'),
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: (r) =>
        canRemit && r.allowed_actions.includes('void') ? (
          <Button size="sm" variant="outline" onClick={() => setVoidTarget(r)}>
            Void
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Tax & EOBI Remittances"
        description="Pay over what the facility has collected for the state — EOBI, salary tax, and tax withheld from suppliers and rent — one period at a time"
      />

      <Card className="mb-6 max-w-3xl p-3">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="tr-month">Period</Label>
            <select id="tr-month" className={SELECT_CLASS} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTH_NAMES_SHORT.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tr-year">Year</Label>
            <Input id="tr-year" type="number" className="w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <p className="text-xs text-muted-foreground">
            Owed at the end of {MONTH_NAMES_SHORT[month - 1]} {year}, less anything already paid over.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Liability</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(outstanding.data ?? []).map((o) => (
              <TableRow key={o.account_code}>
                <TableCell>{o.account_name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(o.outstanding_pkr)}</TableCell>
                <TableCell className="text-right">
                  {canRemit && o.outstanding_pkr > 0 && (
                    <Button size="sm" variant="outline" onClick={() => setPayTarget(o)}>
                      Pay over…
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <h2 className="mb-2 text-sm font-semibold">Remittances</h2>
      <DataTable
        columns={columns}
        data={history.data?.data ?? []}
        meta={history.data?.meta}
        isLoading={history.isLoading}
        isError={history.isError}
        sort={state.sort}
        onSortChange={setSort}
        page={state.page}
        perPage={state.perPage}
        onPageChange={setPage}
        onPerPageChange={setPerPage}
        getRowId={(r) => r.id}
        csvFilename="tax-remittances"
        emptyState={{ title: 'Nothing paid over yet' }}
      />

      <PayOverDialog
        target={payTarget}
        year={year}
        month={month}
        onOpenChange={(o) => !o && setPayTarget(null)}
        onPaid={refresh}
      />
      <VoidDocumentDialog
        title="Void remittance"
        explanation="For a remittance recorded in error: its entry is reversed and the amount is owed again."
        url={voidTarget ? `/v1/accounting/tax-remittances/${voidTarget.id}/void` : null}
        open={voidTarget !== null}
        onOpenChange={(o) => !o && setVoidTarget(null)}
        onVoided={refresh}
      />
    </div>
  );
}

function PayOverDialog({
  target,
  year,
  month,
  onOpenChange,
  onPaid,
}: {
  target: Outstanding | null;
  year: number;
  month: number;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);
  const [date, setDate] = useState(() => localIsoDate());
  const [paidFrom, setPaidFrom] = useState('');
  const [challan, setChallan] = useState('');
  const [busy, setBusy] = useState(false);
  const from = paidFrom || cashAccounts[0]?.account_code || '';

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const doc = await apiClient<{ amount_pkr: number; entry_number: string }>('/v1/accounting/tax-remittances', {
        method: 'POST',
        body: {
          liability_account_code: target.account_code,
          period_year: year,
          period_month: month,
          remittance_date: date,
          paid_from_account_code: from,
          ...(challan.trim() ? { challan_number: challan.trim() } : {}),
        },
      });
      toast.success(`Paid over ${formatMoney(doc.amount_pkr)} — ${doc.entry_number}`);
      setChallan('');
      onOpenChange(false);
      onPaid();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the remittance');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pay over {target?.account_name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {target && `${formatMoney(target.outstanding_pkr)} owed for ${MONTH_NAMES_SHORT[month - 1]} ${year}.`} The
          payment date must fall after the period ends.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="tr-date">Paid on</Label>
          <Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tabular-nums" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tr-from">Paid from</Label>
          <select id="tr-from" className={SELECT_CLASS} value={from} onChange={(e) => setPaidFrom(e.target.value)}>
            {cashAccounts.map((a) => (
              <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tr-challan">Challan / CPR number</Label>
          <Input id="tr-challan" value={challan} onChange={(e) => setChallan(e.target.value)} maxLength={50} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !from} onClick={submit}>Pay over</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
