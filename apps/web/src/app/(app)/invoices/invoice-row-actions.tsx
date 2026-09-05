'use client';

import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/form';
import { qk } from '@/lib/query-keys';
import { formatMoney } from '@/lib/format';
import type { InvoiceRow } from './columns';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

/**
 * Finalize fires directly (single no-field POST, mirrors the detail page's
 * own confirm text); Pay and Void open the dialogs the list page mounts
 * (state has to live there — see invoices/page.tsx). PDF has no permission
 * gate here because it has none on the detail page either (GET .../pdf is
 * authenticate-only) — this mirrors that, not widens it.
 */
export function InvoiceRowActions({
  invoice,
  canManage,
  canVoid,
  onRecordPayment,
  onVoid,
}: {
  invoice: InvoiceRow;
  canManage: boolean;
  canVoid: boolean;
  onRecordPayment: () => void;
  onVoid: () => void;
}) {
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  async function finalize() {
    const ok = await confirm({
      title: 'Finalize Invoice',
      description: `This assigns an invoice number and locks the invoice for editing. Total: ${formatMoney(invoice.total_pkr)}.`,
      confirmText: 'Confirm',
    });
    if (!ok) return;
    try {
      await apiClient(`/v1/invoices/${invoice.id}/finalize`, { method: 'POST', body: {} });
      toast.success('Invoice finalized');
      queryClient.invalidateQueries({ queryKey: qk.invoices.all });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to finalize invoice');
    }
  }

  async function downloadPdf() {
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/invoices/${invoice.id}/pdf`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to load PDF');
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load PDF');
    }
  }

  return (
    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {canManage && invoice.status === 'DRAFT' && (
        <Button size="sm" onClick={finalize}>
          Finalize
        </Button>
      )}
      {invoice.status === 'FINALIZED' && invoice.balance_due_pkr > 0 && (
        <Button size="sm" variant="outline" onClick={onRecordPayment}>
          Pay
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={downloadPdf}>
        PDF
      </Button>
      {canVoid && invoice.status === 'FINALIZED' && invoice.amount_paid_pkr === 0 && (
        <Button size="sm" variant="ghost" className="text-destructive" onClick={onVoid}>
          Void
        </Button>
      )}
    </div>
  );
}
