import { StatusBadge } from '@/components/ui/status-badge';
import type { DataTableColumn } from '@/components/data-table';

export interface PaymentRow {
  id: string;
  party_name: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  reference_number: string | null;
  status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' | 'DISHONOURED';
  allocations: { id: string }[];
}

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
  MOBILE_WALLET: 'Mobile Wallet',
};

const STATUS_TONE: Record<string, 'info' | 'success' | 'warning' | 'danger'> = {
  RECORDED: 'info',
  ALLOCATED: 'success',
  ADVANCE: 'warning',
  DISHONOURED: 'danger',
};

export const paymentColumns: DataTableColumn<PaymentRow>[] = [
  { id: 'date', header: 'Date', cell: (p) => p.payment_date, csv: (p) => p.payment_date },
  {
    id: 'party',
    header: 'Party',
    enableHiding: false,
    cell: (p) => p.party_name,
    csv: (p) => p.party_name,
  },
  {
    id: 'method',
    header: 'Method',
    cell: (p) => METHOD_LABELS[p.payment_method] ?? p.payment_method,
    csv: (p) => p.payment_method,
  },
  {
    id: 'reference',
    header: 'Reference',
    cell: (p) =>
      p.reference_number ? (
        <span className="font-mono">{p.reference_number}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    csv: (p) => p.reference_number ?? '',
  },
  {
    id: 'amount',
    header: 'Amount',
    numeric: true,
    cell: (p) => <span className="font-medium">{p.amount_pkr.toLocaleString()}</span>,
    csv: (p) => p.amount_pkr,
  },
  { id: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} tone={STATUS_TONE[p.status]} />, csv: (p) => p.status },
  {
    id: 'allocations',
    header: 'Allocations',
    numeric: true,
    cell: (p) => p.allocations.length,
    csv: (p) => p.allocations.length,
  },
];
