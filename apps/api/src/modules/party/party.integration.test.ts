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

  // z.coerce.boolean() read the string "false" as true, so the Parties page's
  // "Inactive" filter listed active parties.
  it('GET /v1/parties?is_active=false — lists only inactive parties', async () => {
    const list = async (active: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/parties?is_active=${active}&search=Updated%20Farmer%20Name&per_page=100`,
        headers: authHeaders(ownerToken),
      });
      expect(res.statusCode, res.body).toBe(200);
      return JSON.parse(res.body).data as Array<{ id: string; is_active: boolean }>;
    };
    const inactive = await list('false');
    expect(inactive.map((p) => p.id)).toContain(createdPartyId);
    expect(inactive.every((p) => !p.is_active)).toBe(true);
    expect((await list('true')).map((p) => p.id)).not.toContain(createdPartyId);
  });

  it('GET /v1/parties — rejects a boolean that is neither true nor false', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/parties?is_active=no', headers: authHeaders(ownerToken) });
    expect(res.statusCode).toBe(400);
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

// Pickers search the server instead of loading a capped list, so the server has
// to offer exactly the parties each picker's document accepts: a customer is a
// party on a receivable control account (receivableParty), a supplier one on
// Trade Payables.
describe('Party list · kind filter', () => {
  const tag = `Kind ${Date.now() % 1_000_000}`;
  let customerId: string;
  let supplierId: string;

  beforeAll(async () => {
    const create = async (name: string, party_type: string, phone: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/parties',
        headers: authHeaders(ownerToken),
        payload: { name, party_type, phone_primary: phone, credit_terms_days: 30 },
      });
      expect(res.statusCode, res.body).toBe(201);
      return JSON.parse(res.body).data.id as string;
    };
    customerId = await create(`${tag} buyer`, 'BUYER', '03004440001');
    supplierId = await create(`${tag} supplier`, 'SUPPLIER', '03004440002');
  });

  const ids = async (kind: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/parties?kind=${kind}&search=${encodeURIComponent(tag)}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body).data as Array<{ id: string }>).map((p) => p.id);
  };

  it('kind=customer leaves suppliers out', async () => {
    expect(await ids('customer')).toEqual([customerId]);
  });

  it('kind=supplier lists only suppliers', async () => {
    expect(await ids('supplier')).toEqual([supplierId]);
  });
});

describe('credit limit & terms need parties.credit_terms (MANAGER by default)', () => {
  let partyId: string;
  let managerToken: string;

  const patch = (token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/parties/${partyId}`,
      headers: authHeaders(token),
      payload,
    });

  beforeAll(async () => {
    managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(managerToken),
      payload: {
        name: `Credit Terms Arhti ${Date.now()}`,
        party_type: 'ARHTI',
        phone_primary: '03004450001',
        credit_terms_days: 45,
        credit_limit_pkr: 250000,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    partyId = JSON.parse(res.body).data.id;
  });

  it('the munshi cannot give a new party a credit limit or non-default terms', async () => {
    const withLimit = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: { name: 'Limit By Munshi', party_type: 'FARMER', phone_primary: '03004450002', credit_limit_pkr: 900000 },
    });
    expect(withLimit.statusCode).toBe(403);
    expect(JSON.parse(withLimit.body).error.message).toMatch(/parties\.credit_terms/);

    const longTerms = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: { name: 'Terms By Munshi', party_type: 'FARMER', phone_primary: '03004450003', credit_terms_days: 90 },
    });
    expect(longTerms.statusCode).toBe(403);
  });

  it('the munshi can still edit a party when the form re-sends the unchanged limit and terms', async () => {
    const res = await patch(operatorToken, {
      address: 'Shop 12, Badami Bagh',
      credit_limit_pkr: 250000,
      credit_terms_days: 45,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body).data.address).toBe('Shop 12, Badami Bagh');
  });

  it('the munshi cannot raise the limit or stretch the terms', async () => {
    expect((await patch(operatorToken, { credit_limit_pkr: 999999 })).statusCode).toBe(403);
    expect((await patch(operatorToken, { credit_terms_days: 120 })).statusCode).toBe(403);
    const party = JSON.parse(
      (await app.inject({ method: 'GET', url: `/v1/parties/${partyId}`, headers: authHeaders(managerToken) })).body,
    ).data;
    expect(party.credit_limit_pkr).toBe(250000);
    expect(party.credit_terms_days).toBe(45);
  });

  it('a manager can change both', async () => {
    const res = await patch(managerToken, { credit_limit_pkr: 300000, credit_terms_days: 60 });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.credit_limit_pkr).toBe(300000);
    expect(body.credit_terms_days).toBe(60);
  });
});
