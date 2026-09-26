import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateFixedAssetRequest,
  CommissionAssetRequest,
  DisposeAssetRequest,
  ImpairAssetRequest,
  ReverseDisposalRequest,
  ReverseAssetEntryRequest,
  VoidAssetRequest,
  RunDepreciationRequest,
  FixedAssetListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
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
      const u = request.user!;
      const data = await service.create(u.facilityId, u.userId, u.role, body);
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
      const data = await service.commission(request.user!.facilityId, request.user!.role, id, body);
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
      const u = request.user!;
      const data = await service.dispose(u.facilityId, u.userId, u.role, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/fixed-assets/:id/impair',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { params: IdParam, body: ImpairAssetRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ImpairAssetRequest>;
      const u = request.user!;
      const data = await service.impair(u.facilityId, u.userId, u.role, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  // Corrections (docs/25 C-33). They share the 'fixed_assets.reverse' key — the
  // matrix has one "undo an asset posting" permission.
  const corrections = [
    { path: 'reverse-disposal', body: ReverseDisposalRequest, run: service.reverseDisposal.bind(service) },
    { path: 'reverse-depreciation', body: ReverseAssetEntryRequest, run: service.reverseLatestDepreciation.bind(service) },
    { path: 'reverse-impairment', body: ReverseAssetEntryRequest, run: service.reverseLatestImpairment.bind(service) },
    { path: 'void', body: VoidAssetRequest, run: service.void.bind(service) },
  ] as const;
  for (const c of corrections) {
    app.route({
      method: 'POST',
      url: `/v1/fixed-assets/:id/${c.path}`,
      preHandler: [app.authenticate, app.requirePermission('fixed_assets.reverse')],
      schema: { params: IdParam, body: c.body },
      handler: async (request, reply) => {
        const { id } = request.params as z.infer<typeof IdParam>;
        const u = request.user!;
        const data = await c.run(u.facilityId, u.userId, u.role, id, request.body as any);
        return sendSuccess(reply, data);
      },
    });
  }

  app.route({
    method: 'POST',
    url: '/v1/depreciation/runs',
    preHandler: [app.authenticate, app.requirePermission('fixed_assets.manage')],
    schema: { body: RunDepreciationRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof RunDepreciationRequest>;
      const u = request.user!;
      const data = await service.runMonthlyDepreciation(u.facilityId, u.userId, u.role, body);
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
