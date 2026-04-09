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

describe('Chamber CRUD', () => {
  let createdChamberId: string;

  it('POST /v1/chambers — creates a chamber', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chambers',
      headers: authHeaders(ownerToken),
      payload: {
        name: 'Test Chamber E',
        max_capacity_bags: 2000,
        temperature_min_c: 1.0,
        temperature_max_c: 5.0,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Test Chamber E');
    expect(body.data.max_capacity_bags).toBe(2000);
    expect(body.data.current_occupancy_bags).toBe(0);
    expect(body.data.available_capacity_bags).toBe(2000);
    createdChamberId = body.data.id;
  });

  it('POST /v1/chambers — OPERATOR cannot create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chambers',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Blocked Chamber',
        max_capacity_bags: 1000,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /v1/chambers — lists chambers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chambers',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('GET /v1/chambers/:id — gets chamber detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/chambers/${createdChamberId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(createdChamberId);
    expect(body.data.temperature_logs).toBeDefined();
  });

  it('PATCH /v1/chambers/:id — updates chamber', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/chambers/${createdChamberId}`,
      headers: authHeaders(ownerToken),
      payload: { name: 'Updated Chamber E', notes: 'Updated notes' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Updated Chamber E');
  });

  it('POST /v1/chambers/:id/temperature — logs temperature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/chambers/${createdChamberId}/temperature`,
      headers: authHeaders(operatorToken),
      payload: {
        temperature_c: 3.5,
        source: 'MANUAL',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.temperature_c).toBe(3.5);
    expect(body.data.source).toBe('MANUAL');
  });

  it('GET /v1/chambers/:id — includes temperature logs after logging', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/chambers/${createdChamberId}`,
      headers: authHeaders(ownerToken),
    });
    const body = JSON.parse(res.body);
    expect(body.data.temperature_logs.length).toBeGreaterThan(0);
    expect(body.data.last_temperature).not.toBeNull();
    expect(body.data.last_temperature.temperature_c).toBe(3.5);
  });
});
