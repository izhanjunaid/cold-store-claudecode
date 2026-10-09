'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/** The shapes the payables API returns (docs/25 Q3). Actions always come from the server (C-11). */
export interface BillLine {
  line_number: number;
  expense_account_code: string;
  expense_account_name: string;
  description: string;
  amount_pkr: number;
}

export interface Bill {
  id: string;
  bill_number: string | null;
  supplier_party_id: string;
  supplier_name: string;
  bill_date: string;
  due_date: string | null;
  supplier_reference: string | null;
  description: string;
  subtotal_pkr: number;
  input_tax_pkr: number;
  total_pkr: number;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  book_type: 'PACCI' | 'KATCHI';
  journal_entry_id: string | null;
  entry_number: string | null;
  legacy_expense_voucher_id: string | null;
  paid_pkr: number;
  open_pkr: number;
  payment_status: 'UNPAID' | 'PARTIAL' | 'PAID' | null;
  lines: BillLine[];
  payments: Array<{ supplier_payment_id: string; payment_number: string | null; payment_date: string; amount_pkr: number }>;
  voided_at: string | null;
  void_reason: string | null;
  notes: string | null;
  allowed_actions: Array<'edit' | 'delete' | 'post' | 'pay' | 'void'>;
}

export interface SupplierPayment {
  id: string;
  payment_number: string | null;
  supplier_party_id: string;
  supplier_name: string;
  payment_date: string;
  payment_method: string;
  asset_account_name: string;
  gross_amount_pkr: number;
  withholding_section: 'S153' | 'S155' | null;
  withholding_rate_pct: number | null;
  withholding_pkr: number;
  net_paid_pkr: number;
  certificate_number: string | null;
  reference_number: string | null;
  entry_number: string | null;
  allocated_pkr: number;
  unapplied_pkr: number;
  allocations: Array<{ bill_id: string; bill_number: string | null; amount_pkr: number }>;
  voided_at: string | null;
  void_reason: string | null;
  allowed_actions: Array<'allocate' | 'void'>;
}

/** A supplier's posted bills that still have something to pay, oldest first. */
export function useOpenBills(supplierId: string | null, book: 'PACCI' | 'KATCHI' = 'PACCI') {
  return useQuery({
    queryKey: ['accounting', 'open-bills', supplierId, book],
    enabled: !!supplierId,
    queryFn: () =>
      apiClient<Bill[]>(`/v1/bills?supplier_party_id=${supplierId}&status=POSTED&book_type=${book}&page_size=100`).then(
        (bills) => bills.filter((b) => b.open_pkr > 0).sort((a, b) => a.bill_date.localeCompare(b.bill_date)),
      ),
  });
}

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'MOBILE_WALLET', label: 'Mobile wallet' },
] as const;

export const WITHHOLDING_SECTIONS = [
  { value: 'S153', label: 's.153 — goods, services & contracts' },
  { value: 'S155', label: 's.155 — rent' },
] as const;

export const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
