import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders } from '../../test/helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let ownerToken: string;
let operatorToken: string;

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  const operator = await loginAsRole(app, 'OPERATOR');
  operatorToken = operator.accessToken;
});

afterAll(async () => {
  await closeTestApp();
});

describe('Commodity CRUD', () => {
  let createdCommodityId: string;
  const testCommodityName = `TEST_${Date.now()}`;

  it('GET /v1/commodities — lists commodities with varieties', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/commodities',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
    // Seeded POTATO should have varieties
    const potato = body.data.find((c: { name: string }) => c.name === 'POTATO');
    expect(potato).toBeDefined();
  });

  it('POST /v1/commodities — creates a commodity', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/commodities',
      headers: authHeaders(ownerToken),
      payload: {
        name: testCommodityName,
        unit_label: 'Crates',
        default_storage_days_alert: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe(testCommodityName);
    createdCommodityId = body.data.id;
  });

  it('POST /v1/commodities — OPERATOR cannot create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/commodities',
      headers: authHeaders(operatorToken),
      payload: { name: 'BLOCKED', unit_label: 'Bags' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /v1/commodities/:id — updates commodity', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/commodities/${createdCommodityId}`,
      headers: authHeaders(ownerToken),
      payload: { default_storage_days_alert: 45 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.default_storage_days_alert).toBe(45);
  });

  it('POST /v1/commodities/:id/varieties — creates a variety', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/commodities/${createdCommodityId}/varieties`,
      headers: authHeaders(ownerToken),
      payload: { name: 'Sindhri' },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Sindhri');
    expect(body.data.commodity_id).toBe(createdCommodityId);
  });

  it('GET /v1/commodities/:id/varieties — lists varieties', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/commodities/${createdCommodityId}/varieties`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });
});
