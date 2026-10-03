'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { localIsoDate, round2 } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAccounts, isExpenseAccount } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { EditableRows, type EditableRowColumn } from '@/components/form';
import { formatMoney } from '@/lib/format';
import { SELECT_CLASS, useSuppliers, type Bill } from '../../payables-shared';

type Line = { expense_account_code: string; description: string; amount: string };
const blankLine = (): Line => ({ expense_account_code: '', description: '', amount: '' });

/**
 * A supplier's bill, saved as a draft. Posting (and "pay now") happens on the bill
 * itself, by whoever may approve costs. `?edit=<id>` reopens a draft.
 */
function BillForm() {
  const router = useRouter();
  const editId = useSearchParams().get('edit');
  const { data: suppliers = [] } = useSuppliers();
  const { data: accounts = [] } = useAccounts();
  const expenseAccounts = accounts.filter(isExpenseAccount);

  const [supplierId, setSupplierId] = useState('');
  const [billDate, setBillDate] = useState(() => localIsoDate());
  const [dueDate, setDueDate] = useState('');
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [inputTax, setInputTax] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    apiClient<Bill>(`/v1/bills/${editId}`)
      .then((b) => {
        setSupplierId(b.supplier_party_id);
        setBillDate(b.bill_date);
        setDueDate(b.due_date ?? '');
        setReference(b.supplier_reference ?? '');
        setDescription(b.description);
        setInputTax(b.input_tax_pkr ? String(b.input_tax_pkr) : '');
        setNotes(b.notes ?? '');
        setLines(
          b.lines.map((l) => ({ expense_account_code: l.expense_account_code, description: l.description, amount: String(l.amount_pkr) })),
        );
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Could not load the bill'));
  }, [editId]);

  const subtotal = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const total = round2(subtotal + (Number(inputTax) || 0));
  const valid =
    !!supplierId &&
    !!description.trim() &&
    lines.length > 0 &&
    lines.every((l) => l.expense_account_code && l.description.trim() && Number(l.amount) > 0);

  const columns: EditableRowColumn<Line>[] = [
    {
      key: 'account',
      header: 'Cost account',
      width: '2fr',
      render: (row, update) => (
        <select
          className={SELECT_CLASS}
          aria-label="Cost account"
          value={row.expense_account_code}
          onChange={(e) => update({ expense_account_code: e.target.value })}
        >
          <option value="">Choose…</option>
          {expenseAccounts.map((a) => (
            <option key={a.account_code} value={a.account_code}>{a.account_name}</option>
          ))}
        </select>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: '2fr',
      render: (row, update) => (
        <Input aria-label="Line description" value={row.description} maxLength={300} onChange={(e) => update({ description: e.target.value })} />
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      width: '8rem',
      align: 'right',
      render: (row, update) => (
        <Input aria-label="Line amount" type="number" min="0" step="0.01" value={row.amount} onChange={(e) => update({ amount: e.target.value })} />
      ),
    },
  ];

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        supplier_party_id: supplierId,
        bill_date: billDate,
        due_date: dueDate || null,
        supplier_reference: reference.trim() || null,
        description: description.trim(),
        lines: lines.map((l) => ({
          expense_account_code: l.expense_account_code,
          description: l.description.trim(),
          amount_pkr: Number(l.amount),
        })),
        input_tax_pkr: Number(inputTax) || 0,
        notes: notes.trim() || null,
      };
      const bill = editId
        ? await apiClient<Bill>(`/v1/bills/${editId}`, { method: 'PATCH', body })
        : await apiClient<Bill>('/v1/bills', { method: 'POST', body });
      toast.success('Bill saved as a draft');
      router.push(`/accounting/payables/bills/${bill.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the bill');
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={editId ? 'Edit bill' : 'New bill'}
        description="Saved as a draft; it reaches the books when it is posted, dated at the bill date"
      />
      <Card className="max-w-4xl space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="bill-supplier">Supplier</Label>
            <select id="bill-supplier" className={SELECT_CLASS} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Choose a supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {suppliers.length === 0 && (
              <p className="text-xs text-muted-foreground">Add the supplier under Parties (type: Supplier) first.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="bill-date">Bill date</Label>
            <Input id="bill-date" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bill-due">Due date</Label>
            <Input id="bill-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bill-ref">Supplier&apos;s invoice no.</Label>
            <Input id="bill-ref" value={reference} maxLength={100} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="bill-desc">Description</Label>
            <Input
              id="bill-desc"
              value={description}
              maxLength={500}
              placeholder="e.g. LESCO refrigeration bill — March"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <EditableRows
          rows={lines}
          onChange={setLines}
          columns={columns}
          newRow={blankLine}
          addLabel="Add line"
          minRows={1}
          footer={<span className="tabular-nums">Subtotal {formatMoney(subtotal)}</span>}
        />

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="bill-tax">Input sales tax (adjustable)</Label>
            <Input id="bill-tax" type="number" min="0" step="0.01" value={inputTax} onChange={(e) => setInputTax(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="bill-notes">Notes</Label>
            <Input id="bill-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm">
            Total <span className="font-semibold tabular-nums">{formatMoney(total)}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
            <Button onClick={save} disabled={!valid || saving}>
              {saving ? 'Saving…' : 'Save draft'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function NewBillPage() {
  return (
    <Suspense>
      <BillForm />
    </Suspense>
  );
}
