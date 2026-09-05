import { StatusBadge } from '@/components/ui/status-badge';
import type { DataTableColumn } from '@/components/data-table';
import { PaymentRowActions } from './payment-row-actions';

import { formatDate, formatMoney } from '@/lib/format';
export interface PaymentRow {
  id: string;
  party_id: string;
  party_name: string;
  payment_date: string;
  amount_pkr: number;
  payment_method: string;
  receipt_number: string | null;
  reference_number: string | null;
  status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' | 'DISHONOURED';
  // Returned by the list (PaymentResponse), and what gates the Clear action.
  clearance_status: 'NA' | 'PENDING' | 'CLEARED' | 'BOUNCED';
  allocations: { id: string }[];
}

export interface PaymentColumnHandlers {
  /** `payments.record` — the key the API enforces on clear/dishonour/allocate. */
  canRecord: boolean;
  onClear: (payment: PaymentRow) => void;
  onDishonour: (payment: PaymentRow) => void;
  onApplyAdvance: (payment: PaymentRow) => void;
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

export function getPaymentColumns(
  handlers: PaymentColumnHandlers,
): DataTableColumn<PaymentRow>[] {
  return [...paymentColumns,
  {
    id: 'actions',
    header: '',
    enableHiding: false,
    cell: (p) => (
      <PaymentRowActions
        payment={p}
        canRecord={handlers.canRecord}
        onClear={handlers.onClear}
        onDishonour={handlers.onDishonour}
        onApplyAdvance={handlers.onApplyAdvance}
      />
    ),
  },
  ];
}

export const paymentColumns: DataTableColumn<PaymentRow>[] = [
  {
    id: 'receipt',
    header: 'Receipt #',
    // Payments recorded before receipts were numbered carry none, and are not
    // retro-numbered — a receipt number belongs to a receipt that was issued.
    cell: (p) =>
      p.receipt_number ? (
        <span className="font-mono">{p.receipt_number}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    csv: (p) => p.receipt_number ?? '',
  },
  { id: 'date', header: 'Date', cell: (p) => formatDate(p.payment_date), csv: (p) => p.payment_date },
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
    cell: (p) => <span className="font-medium">{formatMoney(p.amount_pkr)}</span>,
    csv: (p) => p.amount_pkr,
    // Totals the rows on screen, not the facility — the list is paginated.
    footer: (rows) => formatMoney(rows.reduce((s, p) => s + p.amount_pkr, 0)),
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
