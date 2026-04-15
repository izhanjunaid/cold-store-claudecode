import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import errorHandler from './plugins/error-handler';
import facilityScope from './plugins/facility-scope';
import authPlugin from './plugins/auth';
import { authRoutes } from './modules/auth/auth.controller';
import { partyRoutes } from './modules/party/party.controller';
import { chamberRoutes } from './modules/chamber/chamber.controller';
import { commodityRoutes } from './modules/commodity/commodity.controller';
import { ratePlanRoutes } from './modules/rate-plan/rate-plan.controller';
import { serviceChargeRoutes } from './modules/service-charge/service-charge.controller';
import { lotRoutes } from './modules/lot/lot.controller';
import { ownershipTransferRoutes } from './modules/ownership-transfer/ownership-transfer.controller';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] || 'info',
    },
  });

  // Zod validation
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Core plugins
  await app.register(cors, { origin: process.env['CORS_ORIGIN'] || 'http://localhost:3000' });
  await app.register(helmet);
  await app.register(sensible);
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // App plugins
  await app.register(errorHandler);
  await app.register(facilityScope);
  await app.register(authPlugin);

  // Health check
  app.get('/health', async () => {
    return { success: true, data: { status: 'ok' } };
  });

  // Routes
  await app.register(authRoutes);
  await app.register(partyRoutes);
  await app.register(chamberRoutes);
  await app.register(commodityRoutes);
  await app.register(ratePlanRoutes);
  await app.register(serviceChargeRoutes);
  await app.register(lotRoutes);
  await app.register(ownershipTransferRoutes);

  return app;
}
