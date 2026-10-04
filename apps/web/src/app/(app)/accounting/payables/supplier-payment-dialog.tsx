'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { localIsoDate, round2 } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAccounts, isCashOrBank } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate, formatMoney } from '@/lib/format';
import {
  PAYMENT_METHODS,
  SELECT_CLASS,
  WITHHOLDING_SECTIONS,
  useOpenBills,
  useSuppliers,
  type SupplierPayment,
} from './payables-shared';

/**
 * Pay a supplier (JE-33): gross settles their account, they receive it less the tax
 * withheld, and the payment is applied to their open bills. The server computes the
 * tax from the rate, validates the paid-from account against the chart, and refuses an
 * allocation that would over-pay a bill — this only collects the inputs.
 */
export function SupplierPaymentDialog({
  open,
  onOpenChange,
  supplierId: fixedSupplierId,
  billId,
  onPaid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed supplier (paying from a bill); otherwise picked here. */
  supplierId?: string;
  /** A bill to fill first. */
  billId?: string;
  onPaid: (payment: SupplierPayment) => void;
}) {
  const { data: suppliers = [] } = useSuppliers();
  const { data: accounts = [] } = useAccounts();
  const cashAccounts = accounts.filter(isCashOrBank);

  const [supplierId, setSupplierId] = useState(fixedSupplierId ?? '');
  const [date, setDate] = useState(() => localIsoDate());
  const [method, setMethod] = useState<string>('BANK_TRANSFER');
  const [account, setAccount] = useState('');
  const [gross, setGross] = useState('');
  const [section, setSection] = useState('');
  const [rate, setRate] = useState('');
  const [certificate, setCertificate] = useState('');
  const [reference, setReference] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const { data: openBills = [] } = useOpenBills(supplierId || null);

  useEffect(() => {
    if (fixedSupplierId) setSupplierId(fixedSupplierId);
  }, [fixedSupplierId]);

  // Paying from a bill: start with that bill's open amount as the payment.
  useEffect(() => {
    const bill = billId ? openBills.find((b) => b.id === billId) : undefined;
    if (open && bill && !gross) {
      setGross(String(bill.open_pkr));
      setAlloc({ [bill.id]: String(bill.open_pkr) });
    }
  }, [open, billId, openBills, gross]);

  const grossPkr = Number(gross) || 0;
  const allocated = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const withholding = section && Number(rate) > 0 ? round2((grossPkr * Number(rate)) / 100) : 0;

  /** Apply the gross to the oldest bills first. */
  const fillOldestFirst = () => {
    let left = grossPkr;
    const next: Record<string, string> = {};
    for (const b of openBills) {
      if (left <= 0) break;
      const take = Math.min(left, b.open_pkr);
      next[b.id] = String(round2(take));
      left = round2(left - take);
    }
    setAlloc(next);
  };

  const valid = !!supplierId && grossPkr > 0 && allocated <= grossPkr + 0.001 && (!section || Number(rate) > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const payment = await apiClient<SupplierPayment>('/v1/supplier-payments', {
        method: 'POST',
        body: {
          supplier_party_id: supplierId,
          payment_date: date,
          payment_method: method,
          ...(account ? { asset_account_code: account } : {}),
          gross_amount_pkr: grossPkr,
          ...(section ? { withholding_section: section, withholding_rate_pct: Number(rate) } : {}),
          ...(certificate.trim() ? { certificate_number: certificate.trim() } : {}),
          ...(reference.trim() ? { reference_number: reference.trim() } : {}),
          allocations: Object.entries(alloc)
            .filter(([, v]) => Number(v) > 0)
            .map(([bill_id, v]) => ({ bill_id, amount_pkr: Number(v) })),
        },
      });
      toast.success(`Paid ${formatMoney(payment.net_paid_pkr)} — ${payment.payment_number}`);
      setGross('');
      setAlloc({});
      onOpenChange(false);
      onPaid(payment);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pay supplier</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="sp-supplier">Supplier</Label>
            <select
              id="sp-supplier"
              className={SELECT_CLASS}
              value={supplierId}
              disabled={!!fixedSupplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
                setAlloc({});
              }}
            >
              <option value="">Choose a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-date">Date</Label>
            <Input id="sp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-gross">Amount settled (gross)</Label>
            <Input id="sp-gross" type="number" min="0" step="0.01" value={gross} onChange={(e) => setGross(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-method">Method</Label>
            <select id="sp-method" className={SELECT_CLASS} value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-account">Paid from</Label>
            <select id="sp-account" className={SELECT_CLASS} value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">Usual account for this method</option>
              {cashAccounts.map((a) => (
                <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp-section">Tax withheld under</Label>
            <select id="sp-section" className={SELECT_CLASS} value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="">No withholding</option>
              {WITHHOLDING_SECTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {section && (
            <div className="space-y-1">
              <Label htmlFor="sp-rate">Rate (%)</Label>
              <Input id="sp-rate" type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          )}
          {section && (
            <div className="space-y-1">
              <Label htmlFor="sp-cert">Certificate number</Label>
              <Input id="sp-cert" value={certificate} onChange={(e) => setCertificate(e.target.value)} maxLength={50} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="sp-ref">Reference (cheque / transfer no.)</Label>
            <Input id="sp-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </div>
        </div>

        {grossPkr > 0 && (
          <p className="text-xs text-muted-foreground">
            The supplier receives {formatMoney(round2(grossPkr - withholding))}
            {withholding > 0 && `; ${formatMoney(withholding)} is withheld and owed to the FBR`}.
          </p>
        )}

        {supplierId && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Apply to bills</h3>
              <Button type="button" size="sm" variant="outline" onClick={fillOldestFirst} disabled={!grossPkr || !openBills.length}>
                Oldest first
              </Button>
            </div>
            {openBills.length === 0 && <p className="text-xs text-muted-foreground">No open bills — the payment stays on account.</p>}
            {openBills.map((b) => (
              <div key={b.id} className="grid grid-cols-[1fr_auto_8rem] items-center gap-2 text-sm">
                <span>
                  <span className="font-mono">{b.bill_number}</span> · {formatDate(b.bill_date)}
                </span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(b.open_pkr)} open</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label={`Apply to ${b.bill_number}`}
                  value={alloc[b.id] ?? ''}
                  onChange={(e) => setAlloc({ ...alloc, [b.id]: e.target.value })}
                />
              </div>
            ))}
            {allocated > grossPkr + 0.001 && (
              <p className="text-xs text-destructive">More is applied to bills than the payment settles.</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !valid} onClick={submit}>Record payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
