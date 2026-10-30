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

  async function createCharge(name: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/service-charges',
      headers: authHeaders(managerToken),
      payload: { name, unit_type: 'FLAT', unit_price_pkr: 5 },
    });
    return JSON.parse(res.body).data.id;
  }

  it('DELETE /v1/service-charges/:id — deactivates (MANAGER)', async () => {
    const id = await createCharge('Test Delete A');
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/service-charges/${id}`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
  });

  it('DELETE with application/json content-type but no body → 400, not 500', async () => {
    const id = await createCharge('Test Delete B');
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/service-charges/${id}`,
      headers: { ...authHeaders(managerToken), 'content-type': 'application/json' },
    });
    // FST_ERR_CTP_EMPTY_JSON_BODY carries statusCode 400 — the error handler must
    // honour it rather than masking it as INTERNAL_ERROR (500).
    expect(res.statusCode).toBe(400);
  });
});

// Weight optional (docs/27): with weights hidden nothing records a weight, so nothing may be priced by one.
describe('with weights hidden', () => {
  async function storeHideWeights(value: boolean | undefined) {
    const f = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
    const { hide_weights: _old, ...rest } = (f.settings ?? {}) as Record<string, unknown>;
    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: { settings: (value === undefined ? rest : { ...rest, hide_weights: value }) as never },
    });
  }
  const send = (method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) =>
    app.inject({ method, url, headers: authHeaders(managerToken), payload });

  beforeAll(() => storeHideWeights(true));
  afterAll(async () => {
    await storeHideWeights(undefined);
    await prisma.serviceCharge.deleteMany({ where: { facilityId: TEST_FACILITY_ID, name: { startsWith: 'Test PT ' } } });
  });

  it('no charge can end up active and priced per ton', async () => {
    const created = await send('POST', '/v1/service-charges', { name: 'Test PT new', unit_type: 'PER_TON', unit_price_pkr: 500 });
    expect(created.statusCode).toBe(400);
    expect(JSON.parse(created.body).error.code).toBe('VALIDATION_ERROR');

    const inactive = await prisma.serviceCharge.create({
      data: { facilityId: TEST_FACILITY_ID, name: 'Test PT inactive', unitType: 'PER_TON', unitPricePkr: 500, isActive: false },
    });
    expect((await send('PATCH', `/v1/service-charges/${inactive.id}`, { is_active: true })).statusCode).toBe(400);
    // Editing it while it stays inactive is fine.
    expect((await send('PATCH', `/v1/service-charges/${inactive.id}`, { unit_price_pkr: 600 })).statusCode).toBe(200);

    const perBag = await send('POST', '/v1/service-charges', { name: 'Test PT bag', unit_type: 'PER_BAG', unit_price_pkr: 10 });
    expect(perBag.statusCode).toBe(201);
    const perBagId = JSON.parse(perBag.body).data.id;
    expect((await send('PATCH', `/v1/service-charges/${perBagId}`, { unit_type: 'PER_TON' })).statusCode).toBe(400);
  });
});
