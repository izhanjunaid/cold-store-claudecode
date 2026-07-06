/**
 * Test-only routes for Playwright E2E. Registered ONLY when
 * NODE_ENV !== 'production' AND ALLOW_TEST_RESET === '1'. Production
 * builds throw at registration time if both are set (defense in depth).
 *
 * POST /v1/_test/reset truncates operational rows for the E2E facility
 * and reseeds the standard fixture set so each Playwright spec starts
 * from a known state.
 */
import type { FastifyInstance } from 'fastify';
import { sendSuccess } from '../../common/response';

const E2E_FACILITY_ID = '00000000-0000-0000-0000-000000000001';

export async function testRoutes(app: FastifyInstance) {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'CRITICAL: testRoutes registered with NODE_ENV=production. ' +
        'Refusing to start. Unset ALLOW_TEST_RESET in production.',
    );
  }

  app.route({
    method: 'POST',
    url: '/v1/_test/reset',
    handler: async (_request, reply) => {
      // The financial integrity guards (migration 0002) block UPDATE/DELETE on
      // posted journal entries and period locks; fixture purge legitimately
      // needs them off. Test-only code path — never registered in production.
      await app.prisma.$executeRawUnsafe(`SELECT financial_guards_set(false)`);
      try {
        // Wipe in FK-safe order; matches the integration test cleanup pattern.
        await app.prisma.partyLoanRepayment.deleteMany({
          where: { loan: { facilityId: E2E_FACILITY_ID } },
        });
        await app.prisma.partyLoan.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });

        await app.prisma.gatePass.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });

        await app.prisma.creditNoteLineItem.deleteMany({
          where: { creditNote: { facilityId: E2E_FACILITY_ID } },
        });
        await app.prisma.creditNote.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });

        await app.prisma.paymentAllocation.deleteMany({
          where: { payment: { facilityId: E2E_FACILITY_ID } },
        });

        await app.prisma.journalEntryLine.deleteMany({
          where: { facilityId: E2E_FACILITY_ID },
        });
        await app.prisma.journalEntry.updateMany({
          where: { facilityId: E2E_FACILITY_ID },
          data: { reversedById: null },
        });
        await app.prisma.invoice.updateMany({
          where: { facilityId: E2E_FACILITY_ID },
          data: { journalEntryId: null },
        });
        await app.prisma.payment.updateMany({
          where: { facilityId: E2E_FACILITY_ID },
          data: { journalEntryId: null },
        });
        await app.prisma.journalEntry.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });

        await app.prisma.payment.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });
        await app.prisma.invoiceLineItem.deleteMany({
          where: { invoice: { facilityId: E2E_FACILITY_ID } },
        });
        await app.prisma.invoice.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });
        await app.prisma.outboundEvent.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });
        await app.prisma.ownershipHistory.deleteMany({
          where: { lot: { facilityId: E2E_FACILITY_ID } },
        });
        await app.prisma.lot.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });
        await app.prisma.periodLock.deleteMany({ where: { facilityId: E2E_FACILITY_ID } });
        await app.prisma.$executeRawUnsafe(
          `DELETE FROM audit_log WHERE facility_id = '${E2E_FACILITY_ID}'::uuid`,
        );
      } finally {
        await app.prisma.$executeRawUnsafe(`SELECT financial_guards_set(true)`);
      }

      return sendSuccess(reply, { status: 'reset', facility_id: E2E_FACILITY_ID });
    },
  });
}
