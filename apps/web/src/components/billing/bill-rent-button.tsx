'use client';

import { useState } from 'react';
import { ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
import { localIsoDate } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface RentBills {
  as_of_date: string;
  invoices: { invoice_id: string; lot_number: string; total_pkr: number }[];
}

/**
 * Bill the rent owed up to today with the goods still in the room (docs/32 section 2.6):
 * for one lot, or for every lot of a client (the month-end khata bill). The bills are
 * drafts, to be checked and finalised like any other.
 */
export function BillRentButton({ lotId, partyId, onBilled }: { lotId?: string; partyId?: string; onBilled?: () => void }) {
  const [busy, setBusy] = useState(false);

  async function bill() {
    setBusy(true);
    try {
      const r = await apiClient<RentBills>('/v1/billing/rent-bills', {
        method: 'POST',
        body: { as_of_date: localIsoDate(), ...(lotId ? { lot_id: lotId } : {}), ...(partyId ? { party_id: partyId } : {}) },
      });
      if (r.invoices.length === 0) {
        toast.info('No rent is owed up to today that has not been billed already.');
      } else {
        const total = r.invoices.reduce((s, i) => s + i.total_pkr, 0);
        toast.success(
          `${r.invoices.length} draft ${r.invoices.length === 1 ? 'bill' : 'bills'} made for ${formatMoney(total)}. Check and finalise ${r.invoices.length === 1 ? 'it' : 'them'} under Invoices.`,
        );
        onBilled?.();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rent could not be billed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={bill} disabled={busy}>
      <ReceiptText className="h-4 w-4" aria-hidden />
      {busy ? 'Billing…' : 'Bill rent to today'}
    </Button>
  );
}
