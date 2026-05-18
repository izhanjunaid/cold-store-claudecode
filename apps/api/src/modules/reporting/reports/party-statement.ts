import type { PaymentService } from '../../payment/payment.service';

export interface PartyStatementFilters {
  date_from?: string;
  date_to?: string;
  book_type: 'PACCI' | 'KATCHI';
}

export async function getPartyStatement(
  paymentService: PaymentService,
  facilityId: string,
  partyId: string,
  filters: PartyStatementFilters,
) {
  return paymentService.getPartyLedger(facilityId, partyId, {
    fromDate: filters.date_from,
    toDate: filters.date_to,
    bookType: filters.book_type,
  });
}
