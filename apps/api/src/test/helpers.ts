import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import errorHandler from '../plugins/error-handler';
import facilityScope from '../plugins/facility-scope';
import authPlugin from '../plugins/auth';
import { authRoutes } from '../modules/auth/auth.controller';
import { partyRoutes } from '../modules/party/party.controller';
import { chamberRoutes } from '../modules/chamber/chamber.controller';
import { commodityRoutes } from '../modules/commodity/commodity.controller';
import { ratePlanRoutes } from '../modules/rate-plan/rate-plan.controller';
import { serviceChargeRoutes } from '../modules/service-charge/service-charge.controller';
import { lotRoutes } from '../modules/lot/lot.controller';
import { ownershipTransferRoutes } from '../modules/ownership-transfer/ownership-transfer.controller';
import { outboundRoutes } from '../modules/outbound/outbound.controller';
import { invoiceRoutes } from '../modules/invoice/invoice.controller';
import { paymentRoutes } from '../modules/payment/payment.controller';
import { accountingRoutes } from '../modules/accounting/accounting.controller';
import { fixedAssetRoutes } from '../modules/fixed-assets/fixed-asset.controller';
import { payrollRoutes } from '../modules/payroll/payroll.controller';
import { expenseRoutes } from '../modules/expenses/expense.controller';
import { peshgiRoutes } from '../modules/peshgi/peshgi.controller';
import { gatePassRoutes } from '../modules/gate-pass/gate-pass.controller';
import type { FastifyInstance } from 'fastify';

export const TEST_FACILITY_ID = '00000000-0000-0000-0000-000000000001';

let app: FastifyInstance | null = null;

async function buildTestApp(): Promise<FastifyInstance> {
  const testApp = Fastify({ logger: false });
  testApp.setValidatorCompiler(validatorCompiler);
  testApp.setSerializerCompiler(serializerCompiler);
  await testApp.register(cors);
  await testApp.register(helmet);
  await testApp.register(sensible);
  await testApp.register(errorHandler);
  await testApp.register(facilityScope);
  await testApp.register(authPlugin);
  testApp.get('/health', async () => ({ success: true, data: { status: 'ok' } }));
  await testApp.register(authRoutes);
  await testApp.register(partyRoutes);
  await testApp.register(chamberRoutes);
  await testApp.register(commodityRoutes);
  await testApp.register(ratePlanRoutes);
  await testApp.register(serviceChargeRoutes);
  await testApp.register(lotRoutes);
  await testApp.register(ownershipTransferRoutes);
  await testApp.register(outboundRoutes);
  await testApp.register(invoiceRoutes);
  await testApp.register(paymentRoutes);
  await testApp.register(accountingRoutes);
  await testApp.register(fixedAssetRoutes);
  await testApp.register(payrollRoutes);
  await testApp.register(expenseRoutes);
  await testApp.register(peshgiRoutes);
  await testApp.register(gatePassRoutes);
  return testApp;
}

export async function getTestApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildTestApp();
    await app.ready();
  }
  return app;
}

export async function closeTestApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
}

const ROLE_EMAILS: Record<string, string> = {
  OWNER: 'admin@coldchain.pk',
  MANAGER: 'manager@coldchain.pk',
  ACCOUNTANT: 'accountant@coldchain.pk',
  OPERATOR: 'operator@coldchain.pk',
  SECURITY: 'security@coldchain.pk',
};

async function loginAs(testApp: FastifyInstance, email: string) {
  const res = await testApp.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email, password: 'admin123' },
  });
  const body = JSON.parse(res.body);
  return {
    accessToken: body.data.access_token as string,
    refreshToken: body.data.refresh_token as string,
    user: body.data.user,
  };
}

export async function loginAsAdmin(testApp: FastifyInstance) {
  return loginAs(testApp, 'admin@coldchain.pk');
}

export async function loginAsRole(testApp: FastifyInstance, role: string) {
  const email = ROLE_EMAILS[role];
  if (!email) throw new Error(`Unknown role: ${role}`);
  return loginAs(testApp, email);
}

export function authHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    'x-facility-id': TEST_FACILITY_ID,
  };
}
