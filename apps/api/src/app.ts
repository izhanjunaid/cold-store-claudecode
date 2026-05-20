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

  return app;
}
