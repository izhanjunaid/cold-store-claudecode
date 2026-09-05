import { StatusBadge } from '@/components/ui/status-badge';
import type { DataTableColumn } from '@/components/data-table';
import { InvoiceRowActions } from './invoice-row-actions';

import { formatDate, formatMoney } from '@/lib/format';
export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  billing_party_id: string;
  billing_party_name: string;
  lot_number: string;
  invoice_date: string;
  total_pkr: number;
  amount_paid_pkr: number;
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
}

/**
 * The backend only stores DRAFT/FINALIZED/VOID — paid/partly-paid/unpaid is
 * derived here from totals already on the row. PAID and PARTIALLY_PAID reuse
 * StatusBadge's existing tone map; UNPAID isn't in that map, so its tone is
 * passed explicitly (info, matching how a fresh FINALIZED invoice read before).
 */
export function invoicePaymentState(inv: Pick<InvoiceRow, 'status' | 'amount_paid_pkr' | 'balance_due_pkr'>): {
  status: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
} {
  if (inv.status === 'DRAFT') return { status: 'DRAFT' };
  if (inv.status === 'VOID') return { status: 'VOID' };
  if (inv.balance_due_pkr <= 0.001) return { status: 'PAID' };
  if (inv.amount_paid_pkr > 0.001) return { status: 'PARTIALLY_PAID' };
  return { status: 'UNPAID', tone: 'info' };
}

export interface InvoiceColumnHandlers {
  onRecordPayment: (row: InvoiceRow) => void;
  onVoid: (row: InvoiceRow) => void;
  canManage: boolean;
  canVoid: boolean;
}

export function getInvoiceColumns(handlers: InvoiceColumnHandlers): DataTableColumn<InvoiceRow>[] {
  return [
    {
      id: 'invoice_number',
      header: 'Invoice #',
      enableHiding: false,
      cell: (inv) =>
        inv.invoice_number ? (
          <span className="font-mono font-medium text-primary-700">{inv.invoice_number}</span>
        ) : (
          <span className="italic text-muted-foreground">Draft</span>
        ),
      csv: (inv) => inv.invoice_number ?? 'Draft',
    },
    {
      id: 'billing_party',
      header: 'Billing Party',
      cell: (inv) => inv.billing_party_name,
      csv: (inv) => inv.billing_party_name,
    },
    {
      id: 'lot',
      header: 'Lot',
      cell: (inv) => <span className="font-mono text-muted-foreground">{inv.lot_number}</span>,
      csv: (inv) => inv.lot_number,
    },
    {
      id: 'invoice_date',
      header: 'Date',
      cell: (inv) => formatDate(inv.invoice_date),
      csv: (inv) => inv.invoice_date,
    },
    {
      id: 'total',
      header: 'Total',
      numeric: true,
      cell: (inv) => inv.total_pkr.toLocaleString(),
      csv: (inv) => inv.total_pkr,
      footer: (rows) => formatMoney(rows.reduce((s, r) => s + r.total_pkr, 0)),
    },
    {
      id: 'paid',
      header: 'Paid',
      numeric: true,
      cell: (inv) => <span className="text-green-700">{inv.amount_paid_pkr.toLocaleString()}</span>,
      csv: (inv) => inv.amount_paid_pkr,
      footer: (rows) => formatMoney(rows.reduce((s, r) => s + r.amount_paid_pkr, 0)),
    },
    {
      id: 'balance',
      header: 'Balance',
      numeric: true,
      cell: (inv) => (
        <span className={inv.balance_due_pkr > 0 ? 'font-medium text-destructive' : ''}>
          {inv.balance_due_pkr.toLocaleString()}
        </span>
      ),
      csv: (inv) => inv.balance_due_pkr,
      footer: (rows) => formatMoney(rows.reduce((s, r) => s + r.balance_due_pkr, 0)),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (inv) => {
        const { status, tone } = invoicePaymentState(inv);
        return <StatusBadge status={status} tone={tone} />;
      },
      csv: (inv) => invoicePaymentState(inv).status,
    },
    {
      id: 'actions',
      header: '',
      enableHiding: false,
      cell: (inv) => (
        <InvoiceRowActions
          invoice={inv}
          canManage={handlers.canManage}
          canVoid={handlers.canVoid}
          onRecordPayment={() => handlers.onRecordPayment(inv)}
          onVoid={() => handlers.onVoid(inv)}
        />
      ),
    },
  ];
}
