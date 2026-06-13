import { StatusBadge } from '@/components/ui/status-badge';
import type { DataTableColumn } from '@/components/data-table';

export interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  billing_party_name: string;
  lot_number: string;
  invoice_date: string;
  total_pkr: number;
  amount_paid_pkr: number;
  balance_due_pkr: number;
  status: 'DRAFT' | 'FINALIZED' | 'VOID';
}

export const invoiceColumns: DataTableColumn<InvoiceRow>[] = [
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
    cell: (inv) => inv.invoice_date,
    csv: (inv) => inv.invoice_date,
  },
  {
    id: 'total',
    header: 'Total',
    numeric: true,
    cell: (inv) => inv.total_pkr.toLocaleString(),
    csv: (inv) => inv.total_pkr,
  },
  {
    id: 'paid',
    header: 'Paid',
    numeric: true,
    cell: (inv) => <span className="text-green-700">{inv.amount_paid_pkr.toLocaleString()}</span>,
    csv: (inv) => inv.amount_paid_pkr,
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
  },
  {
    id: 'status',
    header: 'Status',
    cell: (inv) => <StatusBadge status={inv.status} />,
    csv: (inv) => inv.status,
  },
];
