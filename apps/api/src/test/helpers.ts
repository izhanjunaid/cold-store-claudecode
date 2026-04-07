import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import errorHandler from '../plugins/error-handler';
import facilityScope from '../plugins/facility-scope';
import authPlugin from '../plugins/auth';
import { authRoutes } from '../modules/auth/auth.controller';
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

export async function loginAsAdmin(testApp: FastifyInstance) {
  const res = await testApp.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email: 'admin@coldchain.pk', password: 'admin123' },
  });
  const body = JSON.parse(res.body);
  return {
    accessToken: body.data.access_token as string,
    refreshToken: body.data.refresh_token as string,
    user: body.data.user,
  };
}
