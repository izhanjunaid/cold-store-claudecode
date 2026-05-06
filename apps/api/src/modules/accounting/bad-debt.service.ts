import type { PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { JournalEntryService } from './journal-entry.service';
import { buildJE08BadDebtWriteOff } from './templates/je-08-bad-debt-writeoff';
import type { BadDebtWriteOffRequestType } from '@coldchain/shared';

export class BadDebtService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  /**
   * OWNER-only. Writes off the outstanding balance of a finalized invoice as bad debt.
   * Posts JE-08 (DR 6080 / CR 1110-1150) and moves the invoice to WRITTEN_OFF status.
   */
  async writeOff(facilityId: string, userId: string, body: BadDebtWriteOffRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: body.invoice_id, facilityId },
        include: { billingParty: { select: { id: true, name: true, partyType: true } } },
      });
      if (!invoice) throw Errors.INVOICE_NOT_FOUND();
      if (invoice.status !== 'FINALIZED') throw Errors.INVOICE_NOT_FINALIZED();

      const outstanding = Number(invoice.totalPkr) - Number(invoice.amountPaidPkr);
      if (outstanding <= 0) {
        throw Errors.VALIDATION_ERROR(
          'Invoice has no outstanding balance to write off',
          'invoice_id',
        );
      }

      const draft = buildJE08BadDebtWriteOff({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        writeOffDate: new Date(body.write_off_date),
        amountPkr: outstanding,
        reason: body.reason,
        bookType: invoice.bookType as 'PACCI' | 'KATCHI',
        party: invoice.billingParty,
      });

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'WRITTEN_OFF',
          amountPaidPkr: { increment: outstanding },
          notes: invoice.notes
            ? `${invoice.notes}\n[BAD-DEBT WRITE-OFF ${body.write_off_date}]: ${body.reason}`
            : `[BAD-DEBT WRITE-OFF ${body.write_off_date}]: ${body.reason}`,
        },
      });

      return {
        invoice_id: updated.id,
        invoice_number: updated.invoiceNumber,
        status: updated.status,
        written_off_amount_pkr: outstanding,
        journal_entry_id: posted.id,
        journal_entry_number: posted.entryNumber,
      };
    });
  }
}
