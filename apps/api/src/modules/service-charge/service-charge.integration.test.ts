import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let managerToken: string;
let operatorToken: string;
let ownerToken: string;
const prisma = new PrismaClient();

beforeAll(async () => {
  app = await getTestApp();
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;

  // Clean up service charges from prior runs (keep seeded fixtures)
  await prisma.serviceCharge.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, name: { startsWith: 'Test ' } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Service Charge CRUD', () => {
  it('POST /v1/service-charges — creates (MANAGER)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: {
        name: 'Test Loading',
        unit_type: 'PER_BAG',
        unit_price_pkr: 12,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Test Loading');
    expect(body.data.unit_type).toBe('PER_BAG');
  });

  it('POST /v1/service-charges — duplicate name → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: { name: 'Test Loading', unit_type: 'PER_BAG', unit_price_pkr: 15 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/service-charges — lists active+inactive when filter absent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/service-charges',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('POST /v1/service-charges — OPERATOR cannot create → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(operatorToken),
      payload: { name: 'Blocked', unit_type: 'FLAT', unit_price_pkr: 50 },
    });
    expect(res.statusCode).toBe(403);
  });
});
