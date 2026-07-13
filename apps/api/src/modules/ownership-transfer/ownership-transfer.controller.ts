import type { FastifyInstance } from 'fastify';
import { CreateOwnershipTransferRequest } from '@coldchain/shared';
import { OwnershipTransferService } from './ownership-transfer.service';
import { OwnershipTransferRepository } from './ownership-transfer.repository';
import { sendSuccess } from '../../common/response';
import { z } from 'zod';

const LotIdParam = z.object({ id: z.string().uuid() });
const TransferParams = z.object({
  id: z.string().uuid(),
  transferId: z.string().uuid(),
});

export async function ownershipTransferRoutes(app: FastifyInstance) {
  const service = new OwnershipTransferService(
    app.prisma,
    new OwnershipTransferRepository(app.prisma),
  );

  // POST /v1/lots/:id/transfer
  app.route({
    method: 'POST',
    url: '/v1/lots/:id/transfer',
    preHandler: [app.authenticate, app.requirePermission('lots.transfer_ownership')],
    schema: { params: LotIdParam, body: CreateOwnershipTransferRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof LotIdParam>;
      const body = request.body as z.infer<typeof CreateOwnershipTransferRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        operatorId: request.user!.userId,
        lotId: id,
        transferType: body.transfer_type,
        toPartyId: body.to_party_id,
        quantityBags: body.quantity_bags,
        transferPricePkr: body.transfer_price_pkr,
        effectiveDate: body.effective_date,
        notes: body.notes,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/lots/:id/transfer/:transferId/acknowledgment
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/transfer/:transferId/acknowledgment',
    preHandler: [app.authenticate, app.requirePermission('lots.transfer_ownership')],
    schema: { params: TransferParams },
    handler: async (request, reply) => {
      const { id, transferId } = request.params as z.infer<typeof TransferParams>;
      const { lotNumber, transferId: tid, pdfBuffer } =
        await service.getAcknowledgmentPdf(request.user!.facilityId, id, transferId);
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `inline; filename="${lotNumber}-transfer-${tid.slice(0, 8)}.pdf"`,
        )
        .send(pdfBuffer);
    },
  });
}
