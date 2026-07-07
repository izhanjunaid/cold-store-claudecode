import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DashboardReportQuery,
  LotAgingReportQuery,
  ReceivablesAgingReportQuery,
  CommodityInventoryReportQuery,
  WeightVarianceReportQuery,
  SeasonalSummaryReportQuery,
  OwnershipTransfersReportQuery,
  PartyStatementQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { resolveBookTypeForRead } from '../accounting/book-gate';
import { PaymentService } from '../payment/payment.service';
import { PaymentRepository } from '../payment/payment.repository';
import { renderPartyStatement } from '../pdf/pdf.service';
import { AppError } from '../../common/errors';
import { Errors } from '../../common/errors';
import { getDashboard } from './reports/dashboard';
import { getLotAging } from './reports/lot-aging';
import { getReceivablesAging } from './reports/receivables-aging';
import { getCommodityInventory } from './reports/commodity-inventory';
import { getWeightVariance } from './reports/weight-variance';
import { getSeasonalSummary } from './reports/seasonal-summary';
import { getOwnershipTransfers } from './reports/ownership-transfers';
import { getPartyStatement } from './reports/party-statement';

const PartyIdParam = z.object({ partyId: z.string().uuid() });

export async function reportingRoutes(app: FastifyInstance) {
  const paymentService = new PaymentService(
    app.prisma,
    new PaymentRepository(app.prisma),
  );

  // ==========================================================
  // GET /v1/reports/dashboard — OPERATOR+ (financial fields ACCOUNTANT+)
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/dashboard',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { querystring: DashboardReportQuery },
    handler: async (request, reply) => {
      const data = await getDashboard(
        app.prisma,
        request.user!.facilityId,
        request.user!.role,
      );
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // GET /v1/reports/lot-aging — MANAGER+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/lot-aging',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { querystring: LotAgingReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof LotAgingReportQuery>;
      const result = await getLotAging(app.prisma, request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // ==========================================================
  // GET /v1/reports/receivables-aging — ACCOUNTANT+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/receivables-aging',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: ReceivablesAgingReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof ReceivablesAgingReportQuery>;
      const result = await getReceivablesAging(
        app.prisma,
        request.user!.facilityId,
        query,
      );
      const { meta, ...payload } = result;
      return sendSuccess(reply, payload, meta);
    },
  });

  // ==========================================================
  // GET /v1/reports/commodity-inventory — MANAGER+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/commodity-inventory',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { querystring: CommodityInventoryReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof CommodityInventoryReportQuery>;
      const data = await getCommodityInventory(
        app.prisma,
        request.user!.facilityId,
        query,
      );
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // GET /v1/reports/weight-variance — MANAGER+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/weight-variance',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { querystring: WeightVarianceReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof WeightVarianceReportQuery>;
      const result = await getWeightVariance(
        app.prisma,
        request.user!.facilityId,
        query,
      );
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // ==========================================================
  // GET /v1/reports/seasonal-summary — OWNER only
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/seasonal-summary',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { querystring: SeasonalSummaryReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof SeasonalSummaryReportQuery>;
      const data = await getSeasonalSummary(
        app.prisma,
        request.user!.facilityId,
        query,
      );
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // GET /v1/reports/ownership-transfers — MANAGER+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/ownership-transfers',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { querystring: OwnershipTransfersReportQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof OwnershipTransfersReportQuery>;
      const result = await getOwnershipTransfers(
        app.prisma,
        request.user!.facilityId,
        query,
      );
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // ==========================================================
  // GET /v1/reports/party-statement/:partyId — ACCOUNTANT+
  // ==========================================================
  app.route({
    method: 'GET',
    url: '/v1/reports/party-statement/:partyId',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: PartyIdParam, querystring: PartyStatementQuery },
    handler: async (request, reply) => {
      const { partyId } = request.params as z.infer<typeof PartyIdParam>;
      const query = request.query as z.infer<typeof PartyStatementQuery>;
      resolveBookTypeForRead(request.user!.role, query.book_type);
      const ledger = await getPartyStatement(
        paymentService,
        request.user!.facilityId,
        partyId,
        {
          date_from: query.date_from,
          date_to: query.date_to,
          book_type: query.book_type,
        },
      );

      if (query.format !== 'pdf') {
        return sendSuccess(reply, ledger);
      }

      const facility = await app.prisma.facility.findFirst({
        where: { id: request.user!.facilityId },
        select: { name: true, city: true },
      });
      if (!facility) throw new AppError('FACILITY_NOT_FOUND', 'Facility does not exist', 404);

      const party = await app.prisma.party.findFirst({
        where: { id: partyId, facilityId: request.user!.facilityId },
        select: { name: true, nameUrdu: true, cnic: true, partyType: true },
      });
      if (!party) throw Errors.PARTY_NOT_FOUND();

      const pdf = await renderPartyStatement({
        facilityName: facility.name,
        facilityCity: facility.city,
        partyName: party.name,
        partyNameUrdu: party.nameUrdu,
        partyType: party.partyType,
        cnic: party.cnic,
        bookType: query.book_type,
        fromDate: query.date_from ?? null,
        toDate: query.date_to ?? null,
        generatedAt: new Date().toISOString(),
        openingBalancePkr: ledger.opening_balance_pkr,
        totalDebitPkr: ledger.total_debit_pkr,
        totalCreditPkr: ledger.total_credit_pkr,
        closingBalancePkr: ledger.closing_balance_pkr,
        entries: ledger.entries.map((e) => ({
          date: e.date,
          type: e.type,
          reference: e.reference,
          description: e.description,
          debitPkr: e.debit_pkr,
          creditPkr: e.credit_pkr,
          balancePkr: e.balance_pkr,
        })),
      });

      const filename = `party-statement-${partyId}-${query.date_from ?? 'all'}-${query.date_to ?? 'all'}.pdf`;
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdf);
    },
  });
}
