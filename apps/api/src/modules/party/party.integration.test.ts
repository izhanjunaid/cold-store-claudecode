import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let ownerToken: string;
let operatorToken: string;
let securityToken: string;

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  const operator = await loginAsRole(app, 'OPERATOR');
  operatorToken = operator.accessToken;
  const security = await loginAsRole(app, 'SECURITY');
  securityToken = security.accessToken;
});

afterAll(async () => {
  await closeTestApp();
});

describe('Party CRUD', () => {
  let createdPartyId: string;

  it('POST /v1/parties — creates a party', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Test Farmer',
        party_type: 'FARMER',
        phone_primary: '03001111111',
        credit_terms_days: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Test Farmer');
    expect(body.data.party_type).toBe('FARMER');
    expect(body.data.is_active).toBe(true);
    createdPartyId = body.data.id;
  });

  it('POST /v1/parties — returns duplicate phone warning', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Another Farmer',
        party_type: 'FARMER',
        phone_primary: '03001111111',
        credit_terms_days: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.warnings).toBeDefined();
    expect(body.data.warnings[0]).toContain('03001111111');
  });

  it('POST /v1/parties — rejects invalid parentArhtiId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name: 'Bad Farmer',
        party_type: 'FARMER',
        phone_primary: '03002222222',
        parent_arhti_id: '00000000-0000-0000-0000-999999999999',
        credit_terms_days: 30,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/parties — SECURITY role cannot create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(securityToken),
      payload: {
        name: 'Blocked Party',
        party_type: 'TRADER',
        phone_primary: '03003333333',
        credit_terms_days: 30,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /v1/parties — lists parties', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/parties',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.meta.total).toBeGreaterThan(0);
    // over_credit_limit is computed only on GET :id — list rows must not carry
    // it (regression: .map(toResponse) leaked the array index into the field).
    for (const row of body.data as Array<Record<string, unknown>>) {
      expect(row).not.toHaveProperty('over_credit_limit');
    }
  });

  it('GET /v1/parties — filters by type', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/parties?type=FARMER',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    for (const party of body.data) {
      expect(party.party_type).toBe('FARMER');
    }
  });

  it('GET /v1/parties — search by name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/parties?search=Test%20Farmer',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('GET /v1/parties/:id — gets party by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/parties/${createdPartyId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(createdPartyId);
  });

  it('GET /v1/parties/:id — returns 404 for non-existent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/parties/00000000-0000-0000-0000-999999999999',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH /v1/parties/:id — updates party', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/parties/${createdPartyId}`,
      headers: authHeaders(operatorToken),
      payload: { name: 'Updated Farmer Name', address: '123 New Address' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('Updated Farmer Name');
    expect(body.data.address).toBe('123 New Address');
  });

  it('DELETE /v1/parties/:id — deactivates party (MANAGER+)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/parties/${createdPartyId}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);

    // Verify deactivated
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/parties/${createdPartyId}`,
      headers: authHeaders(ownerToken),
    });
    const body = JSON.parse(getRes.body);
    expect(body.data.is_active).toBe(false);
  });

  it('DELETE /v1/parties/:id — OPERATOR cannot deactivate', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/parties/${createdPartyId}`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
