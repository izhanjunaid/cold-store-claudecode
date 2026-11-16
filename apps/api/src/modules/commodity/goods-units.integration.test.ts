import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, loginAsRole, authHeaders } from '../../test/helpers';

/**
 * Units belong to the goods (docs/32 section 2.4): each kind of goods has its own unit,
 * and a room's capacity holds a mix of goods through each kind's space factor.
 */
const prisma = new PrismaClient();
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';
let app: FastifyInstance;
let owner: string;
let operator: string;
let partyId: string;
const made = { commodities: [] as string[], chambers: [] as string[], lots: [] as string[] };
const stamp = Date.now();

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: authHeaders(token), payload: payload as never });
  return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
}

async function goods(name: string, extra: Record<string, unknown>) {
  const r = await call('POST', '/v1/commodities', owner, { name: `${name}_${stamp}`, ...extra });
  expect(r.status).toBe(201);
  made.commodities.push(r.body.data.id);
  return r.body.data;
}

async function room(name: string, capacity: number) {
  const r = await call('POST', '/v1/chambers', owner, { name: `${name} ${stamp}`, max_capacity_bags: capacity });
  expect(r.status).toBe(201);
  made.chambers.push(r.body.data.id);
  return r.body.data.id as string;
}

async function arrive(commodityId: string, chamberId: string, quantity: number) {
  const r = await call('POST', '/v1/lots', operator, {
    owner_party_id: partyId, commodity_id: commodityId, rate_plan_id: RATE_PLAN, chamber_id: chamberId,
    quantity_bags: quantity,
  });
  if (r.status === 201) made.lots.push(r.body.data.id);
  return r;
}

beforeAll(async () => {
  app = await getTestApp();
  owner = (await loginAsRole(app, 'OWNER')).accessToken;
  operator = (await loginAsRole(app, 'OPERATOR')).accessToken;
  const p = await call('POST', '/v1/parties', operator, {
    name: `Units Party ${stamp}`, party_type: 'FARMER', phone_primary: `0301${String(stamp).slice(-7)}`, credit_terms_days: 30,
  });
  expect(p.status).toBe(201);
  partyId = p.body.data.id;
});

afterAll(async () => {
  await prisma.lotRackPlacement.deleteMany({ where: { lotId: { in: made.lots } } });
  await prisma.lotMovement.deleteMany({ where: { lotId: { in: made.lots } } });
  await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: made.lots } } });
  await prisma.lot.deleteMany({ where: { id: { in: made.lots } } });
  await prisma.chamber.deleteMany({ where: { id: { in: made.chambers } } });
  await prisma.commodity.deleteMany({ where: { id: { in: made.commodities } } });
  await prisma.party.deleteMany({ where: { id: partyId } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('goods and their units', () => {
  it('goods carry their unit in English and Urdu, a unit weight and a space factor', async () => {
    const apple = await goods('APPLE_PETI', {
      unit_label: 'Crates', unit_name: 'Crate', unit_name_urdu: 'پیٹی', unit_weight_kg: 18, space_factor: 0.5,
    });
    expect(apple).toMatchObject({ unit_label: 'Crates', unit_name: 'Crate', unit_name_urdu: 'پیٹی', unit_weight_kg: 18, space_factor: 0.5 });

    // Left out, the unit name falls back to the label and the factor to 1: what every store had before.
    const plain = await goods('PLAIN', { unit_label: 'Bags' });
    expect(plain).toMatchObject({ unit_name: 'Bags', unit_name_urdu: null, unit_weight_kg: null, space_factor: 1 });

    const listed = (await call('GET', '/v1/commodities', owner)).body.data.find((c: { id: string }) => c.id === apple.id);
    expect(listed.unit_name).toBe('Crate');
  });

  it('the revenue account of goods is chosen, and must be a revenue account', async () => {
    const g = await goods('MANGO', { unit_label: 'Crates', revenue_account_code: '4040' });
    expect(g.revenue_account_code).toBe('4040');
    const bad = await call('PATCH', `/v1/commodities/${g.id}`, owner, { revenue_account_code: '1010' });
    expect(bad.status).toBe(400);
    const ok = await call('PATCH', `/v1/commodities/${g.id}`, owner, { revenue_account_code: '4050' });
    expect(ok.body.data.revenue_account_code).toBe('4050');
  });

  it('a room holds a mix of goods by the space each unit takes', async () => {
    const bags = await goods('POTATO_BORI', { unit_label: 'Bags', unit_name: 'Bag' });
    const crates = await goods('KINNOW_PETI', { unit_label: 'Crates', unit_name: 'Crate', space_factor: 0.5 });
    const roomId = await room('Mixed Room', 100);

    // 150 crates at half a bag each take 75 of the room's 100.
    const first = await arrive(crates.id, roomId, 150);
    expect(first.body.error?.message ?? 'ok').toBe('ok');
    const shown = (await call('GET', `/v1/chambers/${roomId}`, owner)).body.data;
    expect(shown.current_occupancy_bags).toBe(75);

    // 30 bags would make 105: refused. 25 bags fill it exactly.
    const over = await arrive(bags.id, roomId, 30);
    expect(over.status).not.toBe(201);
    expect(over.body.error.code).toBe('CHAMBER_CAPACITY_EXCEEDED');
    expect((await arrive(bags.id, roomId, 25)).status).toBe(201);

    // And 2 more crates (1 unit of room) no longer fit.
    expect((await arrive(crates.id, roomId, 2)).status).not.toBe(201);
  });
});
