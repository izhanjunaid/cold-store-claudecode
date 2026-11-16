import type { Prisma, PrismaClient } from '@coldchain/db';
import { businessDate, fromIsoDate } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { settingsOn } from '../facility/settings-store';
import { buildRentPeriodBill } from './invoice.builder';

/**
 * Rent billed for a period with the goods still in the room (docs/32 section 2.6): the
 * month-end bill of a khata client, the season-end bill for everyone, the bill for goods
 * nobody collects. One DRAFT bill per lot that owes something up to the date; a manager
 * finalises them as any other bill.
 */
export class RentBillService {
  constructor(private prisma: PrismaClient) {}

  async bill(
    facilityId: string,
    userId: string,
    input: { as_of_date: string; lot_id?: string; party_id?: string },
  ): Promise<{ as_of_date: string; invoices: { invoice_id: string; lot_id: string; lot_number: string; total_pkr: number }[] }> {
    if (input.as_of_date > businessDate()) {
      throw Errors.VALIDATION_ERROR('Rent cannot be billed up to a future date', 'as_of_date');
    }
    // Monthly accrual already books rent as it is earned and settles it against the
    // withdrawal bill; a period bill on top would count the same rent twice.
    if ((await settingsOn(this.prisma, facilityId)).revenue_accrual.start_date) {
      throw Errors.VALIDATION_ERROR('Period rent bills are not available while monthly revenue accrual is on', 'as_of_date');
    }
    const asOf = fromIsoDate(input.as_of_date);
    const lots = await this.prisma.lot.findMany({
      where: {
        facilityId,
        status: 'ACTIVE',
        currentBalanceBags: { gt: 0 },
        ...(input.lot_id ? { id: input.lot_id } : {}),
        ...(input.party_id ? { billingPartyId: input.party_id } : {}),
      },
      select: { id: true, lotNumber: true },
      orderBy: { lotNumber: 'asc' },
    });
    if (input.lot_id && lots.length === 0) throw Errors.LOT_NOT_FOUND();

    const invoices = [];
    for (const lot of lots) {
      // One lot, one transaction: the lot row is locked so a dispatch cannot change its
      // balance between the count and the bill.
      const built = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$queryRaw`SELECT id FROM lots WHERE id = ${lot.id}::uuid FOR UPDATE`;
        return buildRentPeriodBill(tx, { facilityId, lotId: lot.id, asOf, createdBy: userId });
      });
      if (built) {
        invoices.push({ invoice_id: built.id, lot_id: lot.id, lot_number: lot.lotNumber, total_pkr: Number(built.totalPkr) });
      }
    }
    return { as_of_date: input.as_of_date, invoices };
  }
}
