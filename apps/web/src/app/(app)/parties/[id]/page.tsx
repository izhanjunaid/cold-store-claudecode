'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, Plus, UserX } from 'lucide-react';
import { apiClient, apiClientList } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { UrduText } from '@/components/ui/urdu-text';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { qk } from '@/lib/query-keys';

import { formatDate, formatMoney } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface Party {
  id: string;
  name: string;
  name_urdu: string | null;
  party_type: string;
  phone_primary: string;
  phone_secondary: string | null;
  address: string | null;
  cnic: string | null;
  parent_arhti_id: string | null;
  parent_arhti_name: string | null;
  credit_limit_pkr: number | null;
  credit_terms_days: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface LotSummary {
  id: string;
  lot_number: string;
  commodity_name: string | null;
  current_balance_bags: number;
  status: string;
  inbound_date: string;
}
interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  lot_number: string;
  invoice_date: string;
  total_pkr: number;
  balance_due_pkr: number;
  status: string;
}
interface PaymentSummary {
  id: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  status: string;
}
interface LedgerEntry {
  id: string;
  date: string;
  type: 'INVOICE' | 'PAYMENT';
  description: string;
  debit_pkr: number;
  credit_pkr: number;
  balance_pkr: number;
}
interface LedgerData {
  entries: LedgerEntry[];
  total_debit_pkr: number;
  total_credit_pkr: number;
  closing_balance_pkr: number;
}
interface LoanSummary {
  id: string;
  loan_number: string;
  issue_date: string;
  principal_pkr: number;
  balance_outstanding_pkr: number;
  status: string;
}

const TABS = ['Active Lots', 'Invoices', 'Payments', 'Ledger', 'Peshgi'] as const;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

export default function PartyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const partyId = params['id'] as string;

  const [party, setParty] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('Active Lots');
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [payments, setPayments] = useState<PaymentSummary[]>([]);
  const [ledger, setLedger] = useState<LedgerData | null>(null);
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [tabLoaded, setTabLoaded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    apiClient<Party>(`/v1/parties/${partyId}`)
      .then(setParty)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [partyId]);

  const loadTab = useCallback(
    async (tab: string) => {
      if (tabLoaded[tab]) return;
      setTabLoaded((prev) => ({ ...prev, [tab]: true }));
      try {
        if (tab === 'Active Lots') {
          setLots((await apiClientList<LotSummary>(`/v1/lots?owner_party_id=${partyId}&status=ACTIVE&page_size=100`)).data);
        } else if (tab === 'Invoices') {
          setInvoices((await apiClientList<InvoiceSummary>(`/v1/invoices?party_id=${partyId}&page_size=100`)).data);
        } else if (tab === 'Payments') {
          setPayments((await apiClientList<PaymentSummary>(`/v1/payments?party_id=${partyId}&page_size=100`)).data);
        } else if (tab === 'Ledger') {
          setLedger(await apiClient<LedgerData>(`/v1/parties/${partyId}/ledger`));
        } else if (tab === 'Peshgi') {
          setLoans((await apiClientList<LoanSummary>(`/v1/loans?party_id=${partyId}&page_size=100`)).data);
        }
      } catch {
        /* handled */
      }
    },
    [partyId, tabLoaded],
  );

  useEffect(() => {
    loadTab('Active Lots');
  }, [partyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const deactivate = useApiMutation<unknown, void>({
    mutationFn: () => apiClient(`/v1/parties/${partyId}`, { method: 'DELETE' }),
    invalidates: [qk.parties.all, qk.parties.detail(partyId)],
    successMessage: 'Party deactivated',
    onSuccess: () => setParty((prev) => (prev ? { ...prev, is_active: false } : null)),
  });

  const handleDeactivate = async () => {
    const ok = await confirm({
      title: 'Deactivate party?',
      description: `${party?.name} will be blocked from new transactions. This can be reversed by an admin.`,
      confirmText: 'Deactivate',
      destructive: true,
    });
    if (ok) deactivate.mutate();
  };

  if (loading) return <PageSkeleton />;
  if (!party) return <p className="p-2 text-destructive">Party not found</p>;

  return (
    <div>
      <PageHeader
        title={party.name}
        crumb={party.name}
        description={party.name_urdu ?? undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/parties/${party.id}/edit`}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Link>
            </Button>
            {party.is_active && (
              <Button variant="outline" onClick={handleDeactivate} disabled={deactivate.isPending}>
                <UserX className="h-4 w-4" aria-hidden />
                Deactivate
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Party Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row
                label="Type"
                value={<StatusBadge status={party.party_type} />}
              />
              <Row label="Status" value={<StatusBadge status={party.is_active ? 'ACTIVE' : 'INACTIVE'} />} />
              <Row label="Phone" value={party.phone_primary} />
              {party.phone_secondary && <Row label="Phone (Alt)" value={party.phone_secondary} />}
              {party.cnic && <Row label="CNIC" value={party.cnic} />}
              {party.address && <Row label="Address" value={party.address} />}
              {party.parent_arhti_name && <Row label="Linked Arhti" value={party.parent_arhti_name} />}
              <Row label="Created" value={formatDate(party.created_at)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Credit Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row
                label="Credit Limit"
                value={party.credit_limit_pkr ? `${formatMoney(party.credit_limit_pkr)}` : 'No limit set'}
              />
              <Row label="Credit Terms" value={`${party.credit_terms_days} days`} />
            </dl>
            {party.notes && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="mt-1 text-sm text-foreground">{party.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <Tabs value={activeTab} onValueChange={(t) => { setActiveTab(t); loadTab(t); }}>
          <div className="border-b px-2">
            <TabsList className="h-auto bg-transparent p-0">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="p-4">
            <TabsContent value="Active Lots" className="mt-0">
              {lots.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No active lots for this party.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot #</TableHead>
                      <TableHead>Commodity</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Inbound</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lots.map((lot) => (
                      <TableRow key={lot.id} className="cursor-pointer" onClick={() => router.push(`/lots/${lot.id}`)}>
                        <TableCell className="font-mono text-primary-700">{lot.lot_number}</TableCell>
                        <TableCell>{lot.commodity_name ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{lot.current_balance_bags.toLocaleString()}</TableCell>
                        <TableCell>{formatDate(lot.inbound_date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="Invoices" className="mt-0">
              {invoices.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No invoices for this party.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Lot</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                        <TableCell className="font-mono text-primary-700">{inv.invoice_number ?? 'Draft'}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{inv.lot_number}</TableCell>
                        <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{inv.total_pkr.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{inv.balance_due_pkr.toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="Payments" className="mt-0">
              <div className="mb-3 flex justify-end">
                <Button size="sm" onClick={() => router.push(`/payments/new?party_id=${partyId}`)}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Record Payment
                </Button>
              </div>
              {payments.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No payments recorded for this party.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((pay) => (
                      <TableRow key={pay.id} className="cursor-pointer" onClick={() => router.push(`/payments/${pay.id}`)}>
                        <TableCell>{formatDate(pay.payment_date)}</TableCell>
                        <TableCell>{pay.payment_method}</TableCell>
                        <TableCell className="font-mono text-muted-foreground">{pay.reference_number ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{pay.amount_pkr.toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={pay.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="Ledger" className="mt-0">
              {!ledger ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading ledger…</p>
              ) : ledger.entries.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No ledger entries for this party.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.entries.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.date}</TableCell>
                          <TableCell><StatusBadge status={e.type} tone={e.type === 'INVOICE' ? 'warning' : 'success'} /></TableCell>
                          <TableCell>{e.description}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.debit_pkr > 0 ? e.debit_pkr.toLocaleString() : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.credit_pkr > 0 ? e.credit_pkr.toLocaleString() : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{e.balance_pkr.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <div className="mt-3 flex flex-wrap justify-between gap-3 border-t pt-3 text-sm">
                    <span className="text-muted-foreground">Total Invoiced: <strong className="text-foreground">{formatMoney(ledger.total_debit_pkr)}</strong></span>
                    <span className="text-muted-foreground">Total Paid: <strong className="text-foreground">{formatMoney(ledger.total_credit_pkr)}</strong></span>
                    <span className={ledger.closing_balance_pkr > 0 ? 'font-semibold text-destructive' : 'font-semibold text-green-600'}>
                      Outstanding: {formatMoney(ledger.closing_balance_pkr)}
                    </span>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="Peshgi" className="mt-0">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {loans.length === 0
                    ? 'No peshgi loans yet.'
                    : `${loans.filter((l) => l.status === 'ACTIVE').length} active · ${loans.length} total`}
                </p>
                <Button asChild size="sm">
                  <Link href={`/loans/issue?party_id=${partyId}`}>
                    <Plus className="h-4 w-4" aria-hidden />
                    Issue Peshgi
                  </Link>
                </Button>
              </div>
              {loans.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loan No.</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead className="text-right">Principal</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loans.map((l) => (
                      <TableRow key={l.id} className="cursor-pointer" onClick={() => router.push(`/loans/${l.id}`)}>
                        <TableCell className="font-mono">{l.loan_number}</TableCell>
                        <TableCell>{formatDate(l.issue_date)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(l.principal_pkr).toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{Number(l.balance_outstanding_pkr).toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={l.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}
