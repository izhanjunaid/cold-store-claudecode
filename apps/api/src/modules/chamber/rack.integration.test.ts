import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

const CHAMBER_A = '00000000-0000-0000-0000-000000000200'; // unrestricted, 1000 bags
const RACK_A1 = '00000000-0000-0000-0000-000000000210'; // R-1, 400 bags
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';
const POTATO_ID = '00000000-0000-0000-0000-000000000100';

let app: FastifyInstance;
let managerToken: string;
let operatorToken: string;

beforeAll(async () => {
  app = await getTestApp();
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;

  // Placements cascade with lots; clean lots so occupancy starts at zero.
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  // Remove racks created by earlier runs of this file (fixture racks persist).
  await prisma.rack.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, name: { startsWith: 'T-' } },
  });
});

afterAll(async () => {
  // Lots first (FK-safe order): their placements cascade, freeing the racks.
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.rack.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, name: { startsWith: 'T-' } },
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Rack CRUD', () => {
  let createdRackId: string;

  it('POST /v1/chambers/:id/racks — MANAGER creates a rack', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/chambers/${CHAMBER_A}/racks`,
      headers: authHeaders(managerToken),
      payload: { name: 'T-1', max_capacity_bags: 300, position: 9 },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('T-1');
    expect(body.data.chamber_id).toBe(CHAMBER_A);
    expect(body.data.max_capacity_bags).toBe(300);
    expect(body.data.current_occupancy_bags).toBe(0);
    expect(body.data.is_active).toBe(true);
    createdRackId = body.data.id;
  });

  it('POST /v1/chambers/:id/racks — OPERATOR cannot create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/chambers/${CHAMBER_A}/racks`,
      headers: authHeaders(operatorToken),
      payload: { name: 'T-Blocked', max_capacity_bags: 100 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST /v1/chambers/:id/racks — duplicate name in same chamber rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/chambers/${CHAMBER_A}/racks`,
      headers: authHeaders(managerToken),
      payload: { name: 'T-1', max_capacity_bags: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH /v1/racks/:id — updates capacity and name', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/racks/${createdRackId}`,
      headers: authHeaders(managerToken),
      payload: { name: 'T-1b', max_capacity_bags: 350 },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.name).toBe('T-1b');
    expect(body.data.max_capacity_bags).toBe(350);
  });

  it('GET /v1/chambers/:id — detail includes racks with occupancy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/chambers/${CHAMBER_A}`,
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data.racks)).toBe(true);
    const rack = body.data.racks.find((r: { id: string }) => r.id === createdRackId);
    expect(rack).toBeDefined();
    expect(rack.current_occupancy_bags).toBe(0);
    expect(typeof body.data.unplaced_bags).toBe('number');
  });

  it('GET /v1/chambers — list includes rack_count', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/chambers',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const chamberA = body.data.find((c: { id: string }) => c.id === CHAMBER_A);
    expect(chamberA.rack_count).toBeGreaterThanOrEqual(3);
  });

  it('PATCH /v1/racks/:id — cannot deactivate a rack holding placements', async () => {
    // Place a lot on the created rack, then try to deactivate it.
    const partyRes = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: { name: 'Rack Test Farmer', party_type: 'FARMER', phone_primary: '03009100001' },
    });
    const partyId = JSON.parse(partyRes.body).data.id;

    const lotRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: {
        owner_party_id: partyId,
        commodity_id: POTATO_ID,
        rate_plan_id: RATE_PLAN,
        chamber_id: CHAMBER_A,
        quantity_bags: 50,
        accepted_weight_kg: 1000,
        placements: [{ rack_id: createdRackId, bags: 50 }],
      },
    });
    expect(lotRes.statusCode).toBe(201);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/racks/${createdRackId}`,
      headers: authHeaders(managerToken),
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /v1/racks/:id/lots — lists lots on the rack with marka and bags', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/racks/${createdRackId}/lots`,
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.length).toBe(1);
    expect(body.data[0].bags).toBe(50);
    expect(body.data[0].owner_party_name).toBe('Rack Test Farmer');
    expect(body.data[0]).toHaveProperty('marka');
    expect(body.data[0]).toHaveProperty('lot_number');
  });

  it('GET /v1/chambers/:id — rack occupancy reflects the placement', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/chambers/${CHAMBER_A}`,
      headers: authHeaders(managerToken),
    });
    const body = JSON.parse(res.body);
    const rack = body.data.racks.find((r: { id: string }) => r.id === createdRackId);
    expect(rack.current_occupancy_bags).toBe(50);
  });

  it('POST /v1/chambers/:id/racks — rack on missing chamber rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/chambers/00000000-0000-0000-0000-00000000dead/racks',
      headers: authHeaders(managerToken),
      payload: { name: 'T-Ghost', max_capacity_bags: 100 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('RACK_A1 fixture is visible on chamber A with its seeded capacity', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/chambers/${CHAMBER_A}`,
      headers: authHeaders(managerToken),
    });
    const body = JSON.parse(res.body);
    const r1 = body.data.racks.find((r: { id: string }) => r.id === RACK_A1);
    expect(r1).toBeDefined();
    expect(r1.max_capacity_bags).toBe(400);
  });
});
