import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
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
import { outboundRoutes } from './modules/outbound/outbound.controller';
import { invoiceRoutes } from './modules/invoice/invoice.controller';
import { paymentRoutes } from './modules/payment/payment.controller';
import { accountingRoutes } from './modules/accounting/accounting.controller';
import { fixedAssetRoutes } from './modules/fixed-assets/fixed-asset.controller';
import { payrollRoutes } from './modules/payroll/payroll.controller';
import { expenseRoutes } from './modules/expenses/expense.controller';
import { peshgiRoutes } from './modules/peshgi/peshgi.controller';
import { gatePassRoutes } from './modules/gate-pass/gate-pass.controller';
import { reportingRoutes } from './modules/reporting/reporting.controller';
import { userRoutes } from './modules/user/user.controller';
import { facilityRoutes } from './modules/facility/facility.controller';
import { testRoutes } from './modules/_test/test.controller';

export async function buildApp() {
  const app = Fastify({
    // Behind Caddy (single-origin reverse proxy) the real client IP arrives in
    // X-Forwarded-For. Trust it so rate-limiting and logs are per-client rather than
    // per-proxy. Safe here: the API is never published to the LAN — only Caddy reaches it.
    trustProxy: true,
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

  // OpenAPI / Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ColdChain API',
        version: '1.0.0',
        description:
          'Cold storage management platform — REST API. All operational endpoints are namespaced under `/v1/` and scoped via the `X-Facility-ID` header.',
      },
      servers: [{ url: 'http://localhost:3001', description: 'Local dev' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'none', deepLinking: true },
  });

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
  await app.register(outboundRoutes);
  await app.register(invoiceRoutes);
  await app.register(paymentRoutes);
  await app.register(accountingRoutes);
  await app.register(fixedAssetRoutes);
  await app.register(payrollRoutes);
  await app.register(expenseRoutes);
  await app.register(peshgiRoutes);
  await app.register(gatePassRoutes);
  await app.register(reportingRoutes);
  await app.register(userRoutes);
  await app.register(facilityRoutes);

  // E2E-only test routes. Double-guarded: NODE_ENV check AND env var check.
  if (process.env['NODE_ENV'] !== 'production' && process.env['ALLOW_TEST_RESET'] === '1') {
    await app.register(testRoutes);
  }

  return app;
}
