import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateFixedAssetRequest,
  CommissionAssetRequest,
  DisposeAssetRequest,
  ReverseDisposalRequest,
  RunDepreciationRequest,
  FixedAssetListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { FixedAssetService } from './fixed-asset.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function fixedAssetRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new FixedAssetService(app.prisma, journalEntry);

  app.route({
    method: 'GET',
    url: '/v1/fixed-assets',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: FixedAssetListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof FixedAssetListQuery>;
      const data = await service.list(request.user!.facilityId, {
        status: q.status,
        category: q.category,
        page: q.page,
        pageSize: q.page_size,
      });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/fixed-assets',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { body: CreateFixedAssetRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateFixedAssetRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const data = await service.create(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/fixed-assets/:id',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/fixed-assets/:id/commission',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { params: IdParam, body: CommissionAssetRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof CommissionAssetRequest>;
      const existing = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existing.book_type);
      const data = await service.commission(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/fixed-assets/:id/dispose',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { params: IdParam, body: DisposeAssetRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof DisposeAssetRequest>;
      const existing = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existing.book_type);
      const data = await service.dispose(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/fixed-assets/:id/reverse-disposal',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.reverse')],
    schema: { params: IdParam, body: ReverseDisposalRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ReverseDisposalRequest>;
      const existing = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existing.book_type);
      const data = await service.reverseDisposal(
        request.user!.facilityId,
        request.user!.userId,
        id,
        body,
      );
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/depreciation/runs',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { body: RunDepreciationRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof RunDepreciationRequest>;
      const data = await service.runMonthlyDepreciation(
        request.user!.facilityId,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/depreciation/runs',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    handler: async (request, reply) => {
      const data = await service.listRuns(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });
}
