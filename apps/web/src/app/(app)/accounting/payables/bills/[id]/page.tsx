'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { formatDate, formatMoney } from '@/lib/format';
import { PAYMENT_METHODS, SELECT_CLASS, WITHHOLDING_SECTIONS, type Bill } from '../../payables-shared';
import { SupplierPaymentDialog } from '../../supplier-payment-dialog';
import { VoidDocumentDialog } from '../../void-document-dialog';

export default function BillDetailPage() {
  const id = useParams()['id'] as string;
  const router = useRouter();
  const queryClient = useQueryClient();
  const canRecord = useCan('expenses.record');
  const canApprove = useCan('expenses.approve');
  const [dialog, setDialog] = useState<'pay' | 'pay_now' | 'void' | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: bill, refetch } = useQuery({
    queryKey: ['accounting', 'bill', id],
    queryFn: () => apiClient<Bill>(`/v1/bills/${id}`),
  });
  const refresh = () => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['accounting'] });
  };

  if (!bill) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const allows = (a: Bill['allowed_actions'][number]) => bill.allowed_actions.includes(a);

  const post = async (body: object, done: string) => {
    setBusy(true);
    try {
      await apiClient(`/v1/bills/${id}/post`, { method: 'POST', body });
      toast.success(done);
      setDialog(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post the bill');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiClient(`/v1/bills/${id}`, { method: 'DELETE' });
      toast.success('Draft discarded');
      router.push('/accounting/payables/bills');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not discard the draft');
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={bill.bill_number ?? 'Draft bill'}
        description={`${bill.supplier_name} — ${bill.description}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {allows('edit') && canRecord && (
              <Button variant="outline" asChild>
                <Link href={`/accounting/payables/bills/new?edit=${bill.id}`}>Edit</Link>
              </Button>
            )}
            {allows('delete') && canRecord && (
              <Button variant="outline" className="text-destructive" disabled={busy} onClick={remove}>
                Discard draft
              </Button>
            )}
            {allows('post') && canApprove && (
              <>
                <Button variant="outline" disabled={busy} onClick={() => post({}, 'Bill posted')}>
                  Post
                </Button>
                <Button disabled={busy} onClick={() => setDialog('pay_now')}>
                  Post &amp; pay now
                </Button>
              </>
            )}
            {allows('pay') && canRecord && <Button onClick={() => setDialog('pay')}>Pay</Button>}
            {allows('void') && canApprove && (
              <Button variant="outline" className="text-destructive" onClick={() => setDialog('void')}>
                Void…
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <StatusBadge status={bill.payment_status ?? bill.status} />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Bill date / due</div>
            {formatDate(bill.bill_date)} {bill.due_date && `→ ${formatDate(bill.due_date)}`}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Total / open</div>
            <span className="tabular-nums">
              {formatMoney(bill.total_pkr)} / {formatMoney(bill.open_pkr)}
            </span>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Entry</div>
            <span className="font-mono">{bill.entry_number ?? '—'}</span>
          </div>
          {bill.supplier_reference && (
            <div>
              <div className="text-xs text-muted-foreground">Supplier&apos;s invoice</div>
              {bill.supplier_reference}
            </div>
          )}
          {bill.voided_at && (
            <div className="sm:col-span-3">
              <div className="text-xs text-muted-foreground">Voided</div>
              {bill.void_reason}
            </div>
          )}
          {bill.legacy_expense_voucher_id && (
            <div className="sm:col-span-4 text-xs text-muted-foreground">
              Converted from an expense voucher: its cost was recognised when the voucher was accrued.
            </div>
          )}
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Cost account</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bill.lines.map((l) => (
            <TableRow key={l.line_number}>
              <TableCell>{l.expense_account_name}</TableCell>
              <TableCell>{l.description}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(l.amount_pkr)}</TableCell>
            </TableRow>
          ))}
          {bill.input_tax_pkr > 0 && (
            <TableRow>
              <TableCell colSpan={2}>Input sales tax</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(bill.input_tax_pkr)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {bill.payments.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold">Payments</h2>
          <Table>
            <TableBody>
              {bill.payments.map((p) => (
                <TableRow key={p.supplier_payment_id}>
                  <TableCell className="font-mono">{p.payment_number}</TableCell>
                  <TableCell>{formatDate(p.payment_date)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.amount_pkr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      <SupplierPaymentDialog
        open={dialog === 'pay'}
        onOpenChange={(o) => !o && setDialog(null)}
        supplierId={bill.supplier_party_id}
        billId={bill.id}
        onPaid={refresh}
      />
      <PayNowDialog open={dialog === 'pay_now'} total={bill.total_pkr} busy={busy} onOpenChange={(o) => !o && setDialog(null)} onSubmit={(payNow) => post({ pay_now: payNow }, 'Bill posted and paid')} />
      <VoidDocumentDialog
        title="Void bill"
        explanation="For a bill entered in error: its entry is reversed and the bill stays on the list, marked void."
        url={`/v1/bills/${bill.id}/void`}
        open={dialog === 'void'}
        onOpenChange={(o) => !o && setDialog(null)}
        onVoided={refresh}
      />
    </div>
  );
}

/** "Pay now": the bill is posted and paid in full in one action (the server does both in one transaction). */
function PayNowDialog({
  open,
  total,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  total: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payNow: Record<string, unknown>) => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);
  const [date, setDate] = useState(() => localIsoDate());
  const [method, setMethod] = useState('CASH');
  const [account, setAccount] = useState('');
  const [section, setSection] = useState('');
  const [rate, setRate] = useState('');
  const [certificate, setCertificate] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Post and pay {formatMoney(total)}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="pn-date">Paid on</Label>
            <Input id="pn-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pn-method">Method</Label>
            <select id="pn-method" className={SELECT_CLASS} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="pn-account">Paid from</Label>
            <select id="pn-account" className={SELECT_CLASS} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Usual account for this method</option>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pn-section">Tax withheld under</Label>
            <select id="pn-section" className={SELECT_CLASS} value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">No withholding</option>
              {WITHHOLDING_SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {section && (
            <div className="space-y-1">
              <Label htmlFor="pn-rate">Rate (%) <span className="text-destructive">*</span></Label>
              <Input id="pn-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
              {!(Number(rate) > 0) && (
                <p className="text-xs text-muted-foreground">The rate this supplier is charged under this section — required.</p>
              )}
            </div>
          )}
          {section && (
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="pn-cert">Certificate number</Label>
              <Input id="pn-cert" value={certificate} maxLength={50} onChange={(e) => setCertificate(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy || (!!section && !(Number(rate) > 0))}
            onClick={() =>
              onSubmit({
                payment_date: date,
                payment_method: method,
                ...(account ? { asset_account_code: account } : {}),
                ...(section ? { withholding_section: section, withholding_rate_pct: Number(rate) } : {}),
                ...(certificate.trim() ? { certificate_number: certificate.trim() } : {}),
              })
            }
          >
            Post &amp; pay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
