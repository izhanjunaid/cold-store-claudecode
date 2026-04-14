import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders } from '../../test/helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let managerToken: string;
let operatorToken: string;
let ownerToken: string;

const POTATO_ID = '00000000-0000-0000-0000-000000000100';

beforeAll(async () => {
  app = await getTestApp();
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
});

afterAll(async () => {
  await closeTestApp();
});

describe('Rate Plan CRUD', () => {
  let createdId: string;

  it('POST /v1/rate-plans — rejects SEASONAL without season dates', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rate-plans',
      headers: authHeaders(managerToken),
      payload: {
        name: 'Bad Seasonal',
        commodity_id: POTATO_ID,
        rate_type: 'SEASONAL_PER_BAG',
        rate_amount_pkr: 250,
        min_billing_days: 1,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/rate-plans — creates SEASONAL plan (MANAGER)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rate-plans',
      headers: authHeaders(managerToken),
      payload: {
        name: 'Test Potato Seasonal',
        commodity_id: POTATO_ID,
        rate_type: 'SEASONAL_PER_BAG',
        rate_amount_pkr: 250,
        season_start_date: '2026-03-01',
        season_end_date: '2026-09-30',
        min_billing_days: 1,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.rate_type).toBe('SEASONAL_PER_BAG');
    expect(body.data.rate_amount_pkr).toBe(250);
    createdId = body.data.id;
  });

  it('POST /v1/rate-plans — OPERATOR cannot create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/rate-plans',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Operator Plan',
        rate_type: 'DAILY_PER_BAG',
        rate_amount_pkr: 5,
        min_billing_days: 1,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /v1/rate-plans — lists plans, filterable by commodity_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/rate-plans?commodity_id=${POTATO_ID}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
    for (const plan of body.data) {
      expect(plan.commodity_id).toBe(POTATO_ID);
    }
  });

  it('PATCH /v1/rate-plans/:id — updates rate amount', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/rate-plans/${createdId}`,
      headers: authHeaders(managerToken),
      payload: { rate_amount_pkr: 300 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.rate_amount_pkr).toBe(300);
  });

  it('DELETE /v1/rate-plans/:id — soft deactivate', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/rate-plans/${createdId}`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);

    const verify = await app.inject({
      method: 'GET',
      url: `/v1/rate-plans/${createdId}`,
      headers: authHeaders(ownerToken),
    });
    const body = JSON.parse(verify.body);
    expect(body.data.is_active).toBe(false);
  });
});
