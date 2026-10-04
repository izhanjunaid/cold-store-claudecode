'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatMoney } from '@/lib/format';

const BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'days_1_30', label: '1–30' },
  { key: 'days_31_60', label: '31–60' },
  { key: 'days_61_90', label: '61–90' },
  { key: 'days_over_90', label: '90+' },
] as const;

type Amounts = Record<(typeof BUCKETS)[number]['key'], number> & {
  open_bills_pkr: number;
  unapplied_payments_pkr: number;
  other_pkr: number;
  balance_pkr: number;
};

interface Aging {
  suppliers: Array<Amounts & { party_id: string; party_name: string; gl_balance_pkr: number }>;
  totals: Amounts;
  tie_out: { gl_payables_pkr: number; sub_ledger_pkr: number; difference_pkr: number; is_reconciled: boolean };
}

/**
 * What the facility owes each supplier, by how overdue it is — read from the ledger,
 * with open bills, payments on account and other lines (opening balances, corrections)
 * as the items behind it. It ties to Trade Payables by construction; the footer says so.
 */
export default function PayablesAgingPage() {
  const canView = useCan('reports.financial');
  const { data, isLoading } = useQuery({
    queryKey: ['accounting', 'payables-aging'],
    queryFn: () => apiClient<Aging>('/v1/payables/aging'),
    enabled: canView,
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="Payables aging" />
        <p className="text-muted-foreground">You don&apos;t have permission to view financial reports.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Payables aging" description="What the facility owes its suppliers, by days past the due date" />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data && (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  {BUCKETS.map((b) => (
                    <TableHead key={b.key} className="text-right">{b.label}</TableHead>
                  ))}
                  <TableHead className="text-right">Paid on account</TableHead>
                  <TableHead className="text-right">Other</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.suppliers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={BUCKETS.length + 4} className="text-muted-foreground">Nothing is owed to suppliers.</TableCell>
                  </TableRow>
                )}
                {data.suppliers.map((s) => (
                  <TableRow key={s.party_id}>
                    <TableCell>
                      <Link className="text-primary-700 hover:underline" href={`/accounting/payables/suppliers/${s.party_id}`}>
                        {s.party_name}
                      </Link>
                    </TableCell>
                    {BUCKETS.map((b) => (
                      <TableCell key={b.key} className="text-right tabular-nums">{s[b.key] ? formatMoney(s[b.key]) : '—'}</TableCell>
                    ))}
                    <TableCell className="text-right tabular-nums">{s.unapplied_payments_pkr ? `(${formatMoney(s.unapplied_payments_pkr)})` : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.other_pkr ? formatMoney(s.other_pkr) : '—'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatMoney(s.balance_pkr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>Total</TableCell>
                  {BUCKETS.map((b) => (
                    <TableCell key={b.key} className="text-right tabular-nums">{formatMoney(data.totals[b.key])}</TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">({formatMoney(data.totals.unapplied_payments_pkr)})</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(data.totals.other_pkr)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(data.totals.balance_pkr)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className={`mt-3 text-xs ${data.tie_out.is_reconciled ? 'text-muted-foreground' : 'text-destructive'}`}>
            {data.tie_out.is_reconciled
              ? `Agrees with Trade Payables in the ledger (${formatMoney(data.tie_out.gl_payables_pkr)}).`
              : `Differs from Trade Payables in the ledger (${formatMoney(data.tie_out.gl_payables_pkr)}) by ${formatMoney(data.tie_out.difference_pkr)} — a line on the account names no supplier.`}
          </p>
        </>
      )}
    </div>
  );
}
