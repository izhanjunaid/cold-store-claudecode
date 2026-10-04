'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';

interface Statement {
  party_name: string;
  opening_balance_pkr: number;
  closing_balance_pkr: number;
  lines: Array<{
    date: string;
    entry_number: string;
    description: string;
    source_table: string;
    source_id: string;
    debit_pkr: number;
    credit_pkr: number;
    running_balance_pkr: number;
  }>;
  open_bills: Array<{ id: string; bill_number: string | null; bill_date: string; due_date: string | null; total_pkr: number; open_pkr: number }>;
}

const startOfYear = () => `${new Date().getUTCFullYear()}-01-01`;

/** A supplier's account as the ledger has it: every line, a running balance, and the bills still open. */
export default function SupplierStatementPage() {
  const id = useParams()['id'] as string;
  const [from, setFrom] = useState(startOfYear);
  const [to, setTo] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['accounting', 'supplier-statement', id, from, to],
    queryFn: () =>
      apiClient<Statement>(
        `/v1/payables/suppliers/${id}/statement?${new URLSearchParams({ ...(from ? { date_from: from } : {}), ...(to ? { date_to: to } : {}) })}`,
      ),
  });

  return (
    <div>
      <PageHeader title={data ? `${data.party_name} — statement` : 'Supplier statement'} description="Credits are what the supplier billed; debits are what was paid" />
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="space-y-1">
          <Label htmlFor="st-from">From</Label>
          <Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="st-to">To</Label>
          <Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
        </div>
        {data && (
          <div className="ml-auto text-sm">
            Owed <span className="font-semibold tabular-nums">{formatMoney(data.closing_balance_pkr)}</span>
          </div>
        )}
      </Card>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the statement'}</p>}
      {data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Paid (Dr)</TableHead>
                <TableHead className="text-right">Billed (Cr)</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">Opening balance</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(data.opening_balance_pkr)}</TableCell>
              </TableRow>
              {data.lines.map((l, i) => (
                <TableRow key={`${l.entry_number}-${i}`}>
                  <TableCell className="whitespace-nowrap">{formatDate(l.date)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {l.source_table === 'bills' ? (
                      <Link className="hover:underline" href={`/accounting/payables/bills/${l.source_id}`}>{l.entry_number}</Link>
                    ) : (
                      l.entry_number
                    )}
                  </TableCell>
                  <TableCell>{l.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.debit_pkr ? formatMoney(l.debit_pkr) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.credit_pkr ? formatMoney(l.credit_pkr) : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.running_balance_pkr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <h2 className="mb-2 mt-6 text-sm font-semibold">Open bills</h2>
          {data.open_bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bill is waiting to be paid.</p>
          ) : (
            <Table>
              <TableBody>
                {data.open_bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono">
                      <Link className="hover:underline" href={`/accounting/payables/bills/${b.id}`}>{b.bill_number}</Link>
                    </TableCell>
                    <TableCell>{formatDate(b.bill_date)}</TableCell>
                    <TableCell>{b.due_date ? `due ${formatDate(b.due_date)}` : ''}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(b.open_pkr)} of {formatMoney(b.total_pkr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
