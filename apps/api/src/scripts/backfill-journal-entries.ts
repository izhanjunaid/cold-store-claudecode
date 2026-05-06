/**
 * Phase 8 backfill: generate journal entries for finalized invoices and recorded payments
 * that were created BEFORE Phase 8 wiring was deployed (i.e. their journal_entry_id is NULL).
 *
 * Idempotent: re-running skips records that already have a journalEntryId. Safe to run multiple
 * times during development.
 *
 * Usage:
 *   pnpm --filter @coldchain/api exec tsx src/scripts/backfill-journal-entries.ts
 */

import { PrismaClient } from '@coldchain/db';
import { JournalEntryService } from '../modules/accounting/journal-entry.service';
import { PeriodLockService } from '../modules/accounting/period-lock.service';
import { buildJE01InvoiceFinalized } from '../modules/accounting/templates/je-01-invoice-finalized';
import { buildJE02PaymentReceived } from '../modules/accounting/templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../modules/accounting/templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../modules/accounting/templates/je-04-advance-applied';
import { assetAccountForPaymentMethod } from '../modules/accounting/templates/types';

const prisma = new PrismaClient();

async function main() {
  const periodLock = new PeriodLockService(prisma);
  const journalEntry = new JournalEntryService(prisma, periodLock);

  console.log('Phase 8 backfill — generating JEs for pre-Phase-8 records\n');

  // 1. Finalized invoices missing journalEntryId
  const invoices = await prisma.invoice.findMany({
    where: {
      status: 'FINALIZED',
      journalEntryId: null,
    },
    include: {
      billingParty: { select: { id: true, name: true, partyType: true } },
      lot: {
        select: {
          id: true,
          lotNumber: true,
          commodity: { select: { name: true } },
        },
      },
      lineItems: {
        orderBy: { sortOrder: 'asc' },
        include: {
          serviceCharge: { select: { revenueAccountCode: true } },
          ratePlan: { select: { revenueAccountCode: true } },
        },
      },
    },
    orderBy: { invoiceDate: 'asc' },
  });

  console.log(`Found ${invoices.length} finalized invoice(s) needing JE-01`);

  let invoicesPosted = 0;
  for (const inv of invoices) {
    const draft = buildJE01InvoiceFinalized({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber ?? `INV-${inv.id.slice(0, 8)}`,
      invoiceDate: inv.invoiceDate,
      totalPkr: Number(inv.totalPkr),
      gstAmountPkr: Number(inv.gstAmountPkr),
      bookType: inv.bookType as 'PACCI' | 'KATCHI',
      billingParty: inv.billingParty,
      lot: {
        id: inv.lot.id,
        lotNumber: inv.lot.lotNumber,
        commodityName: inv.lot.commodity.name,
      },
      lines: inv.lineItems.map((l) => ({
        lineType: l.lineType,
        description: l.description,
        amountPkr: Number(l.amountPkr),
        serviceChargeRevenueCode: l.serviceCharge?.revenueAccountCode ?? null,
        ratePlanRevenueCode: l.ratePlan?.revenueAccountCode ?? null,
      })),
    });

    try {
      const posted = await journalEntry.post(
        inv.facilityId,
        inv.finalizedBy ?? inv.createdBy,
        draft,
        { postingStatus: 'POSTED' },
      );
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { journalEntryId: posted.id },
      });
      invoicesPosted += 1;
      console.log(`  JE-01 posted: ${posted.entryNumber} ← invoice ${inv.invoiceNumber ?? inv.id.slice(0, 8)} (Rs. ${draft.lines[0]?.debitAmount})`);
    } catch (err) {
      console.error(`  Failed for invoice ${inv.id}: ${(err as Error).message}`);
    }
  }

  // 2. Non-dishonoured payments missing journalEntryId
  const payments = await prisma.payment.findMany({
    where: {
      journalEntryId: null,
      status: { not: 'DISHONOURED' },
    },
    include: {
      party: { select: { id: true, name: true, partyType: true } },
      allocations: {
        include: {
          invoice: { select: { id: true, invoiceNumber: true } },
        },
      },
    },
    orderBy: { paymentDate: 'asc' },
  });

  console.log(`\nFound ${payments.length} payment(s) needing JE-02/03/04`);

  let paymentsPosted = 0;
  for (const pay of payments) {
    const assetCode = pay.assetAccountCode ?? assetAccountForPaymentMethod(pay.paymentMethod);
    const bookType = pay.bookType as 'PACCI' | 'KATCHI';

    // First post JE-02 or JE-03 covering the cash receipt
    const cashDraft = pay.isAdvance
      ? buildJE03AdvanceReceived({
          paymentId: pay.id,
          paymentDate: pay.paymentDate,
          amountPkr: Number(pay.amountPkr),
          paymentMethod: pay.paymentMethod,
          referenceNumber: pay.referenceNumber,
          bookType,
          party: pay.party,
          assetAccountCode: assetCode,
        })
      : buildJE02PaymentReceived({
          paymentId: pay.id,
          paymentDate: pay.paymentDate,
          amountPkr: Number(pay.amountPkr),
          paymentMethod: pay.paymentMethod,
          referenceNumber: pay.referenceNumber,
          bookType,
          party: pay.party,
          assetAccountCode: assetCode,
        });

    try {
      const posted = await journalEntry.post(pay.facilityId, pay.createdBy, cashDraft, {
        postingStatus: 'POSTED',
      });
      await prisma.payment.update({
        where: { id: pay.id },
        data: {
          journalEntryId: posted.id,
          assetAccountCode: pay.assetAccountCode ?? assetCode,
        },
      });
      paymentsPosted += 1;
      console.log(`  ${cashDraft.entryType} posted: ${posted.entryNumber} ← payment ${pay.id.slice(0, 8)} (Rs. ${Number(pay.amountPkr)})`);

      // For ADVANCE payments that have already been allocated, post JE-04 per allocation
      if (pay.isAdvance && pay.allocations.length > 0) {
        for (const alloc of pay.allocations) {
          const draft = buildJE04AdvanceApplied({
            paymentId: pay.id,
            invoiceId: alloc.invoice.id,
            invoiceNumber: alloc.invoice.invoiceNumber,
            appliedDate: pay.paymentDate,
            amountPkr: Number(alloc.allocatedAmountPkr),
            bookType,
            party: pay.party,
          });
          const posted2 = await journalEntry.post(pay.facilityId, pay.createdBy, draft, {
            postingStatus: 'POSTED',
          });
          console.log(`  JE-04 posted: ${posted2.entryNumber} ← advance applied to ${alloc.invoice.invoiceNumber ?? alloc.invoice.id.slice(0, 8)}`);
        }
      }
    } catch (err) {
      console.error(`  Failed for payment ${pay.id}: ${(err as Error).message}`);
    }
  }

  console.log(`\nBackfill complete: ${invoicesPosted} invoices, ${paymentsPosted} payments processed`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
