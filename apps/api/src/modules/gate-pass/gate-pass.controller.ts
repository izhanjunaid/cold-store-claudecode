import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ClearOutwardRequest,
  GatePassListQuery,
  LinkLotRequest,
  LogInwardRequest,
  LogOutwardRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { Errors } from '../../common/errors';
import { GatePassRepository } from './gate-pass.repository';
import { GatePassService } from './gate-pass.service';
import { renderGatePassReceipt } from '../pdf/pdf.service';

const IdParam = z.object({ id: z.string().uuid() });
const FormatQuery = z.object({ format: z.enum(['json', 'pdf']).default('json') });

const LogOutwardWithCreditAuth = LogOutwardRequest.extend({
  credit_authorization: z.boolean().optional(),
});

function formatTurnaround(seconds: number | null): string | null {
  if (seconds === null) return null;
  const mins = Math.floor(seconds / 60);
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hrs > 0) return `${hrs}h ${remMin}m`;
  return `${mins}m`;
}

export async function gatePassRoutes(app: FastifyInstance) {
  const service = new GatePassService(app.prisma, new GatePassRepository(app.prisma));

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/inward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { body: LogInwardRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof LogInwardRequest>;
      const data = await service.logInward(
        request.user!.facilityId,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/outward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { body: LogOutwardWithCreditAuth },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof LogOutwardWithCreditAuth>;
      const data = await service.logOutward(
        request.user!.facilityId,
        request.user!.userId,
        request.user!.role,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/gate-passes',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { querystring: GatePassListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof GatePassListQuery>;
      const data = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/gate-passes/:id',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/gate-passes/:id/link-lot',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam, body: LinkLotRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof LinkLotRequest>;
      const data = await service.linkLot(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/:id/outward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { params: IdParam, body: ClearOutwardRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ClearOutwardRequest>;
      const data = await service.clearOutward(
        request.user!.facilityId,
        id,
        request.user!.role,
        body,
      );
      return sendSuccess(reply, data);
    },
  });

  // GET /v1/gate-passes/:id/receipt?format=json|pdf — SECURITY+
  app.route({
    method: 'GET',
    url: '/v1/gate-passes/:id/receipt',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { params: IdParam, querystring: FormatQuery },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { format } = request.query as z.infer<typeof FormatQuery>;
      const facilityId = request.user!.facilityId;
      const pass = await service.getById(facilityId, id);

      if (format === 'pdf') {
        const facility = await app.prisma.facility.findUnique({
          where: { id: facilityId },
          select: { name: true, city: true },
        });
        if (!facility) throw Errors.GATE_PASS_NOT_FOUND();
        const buf = await renderGatePassReceipt({
          facilityName: facility.name,
          facilityCity: facility.city,
          passNumber: pass.pass_number,
          direction: pass.direction,
          vehicleNumber: pass.vehicle_number,
          driverName: pass.driver_name,
          driverPhone: pass.driver_phone,
          biltyNumber: pass.bilty_number,
          status: pass.status,
          relatedLotNumber: pass.related_lot_number ?? null,
          relatedDispatchNoteNumber: pass.related_dispatch_note_number ?? null,
          commodityName: pass.related_commodity_name ?? null,
          marka: pass.related_marka ?? null,
          unitLabel: pass.related_unit_label ?? null,
          declaredQuantity: pass.declared_quantity ?? null,
          authorizedQuantity: pass.authorized_quantity ?? null,
          quantityMismatch: pass.quantity_mismatch_flag,
          depositorName: pass.party_name ?? null,
          ownerName: pass.owner_party_name ?? null,
          createdAt: pass.created_at,
          clearedAt: pass.cleared_at,
          turnaroundLabel: formatTurnaround(pass.turnaround_seconds),
          notes: pass.notes,
        });
        reply
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `inline; filename="${pass.pass_number}-receipt.pdf"`,
          );
        return reply.send(buf);
      }

      return sendSuccess(reply, pass);
    },
  });
}
