import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../test/helpers';
import { billingFixture, POTATO_ID, CHAMBER_A } from '../invoice/__tests__/billing-fixture';

/** A rate agreed with one client (docs/32 section 2.5): it prices his lots, and nobody else's. */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const plans: string[] = [];

async function plan(body: Record<string, unknown>) {
  const r = await fx.call('POST', '/v1/rate-plans', fx.tokens.owner, {
    name: `Client rate ${Date.now()}-${plans.length}`, rate_type: 'MONTHLY_PER_BAG', rate_amount_pkr: 80, min_billing_days: 1, ...body,
  });
  expect(r.status).toBe(201);
  plans.push(r.body.data.id);
  return r.body.data;
}

const arrive = (ownerId: string, ratePlanId: string, extra: Record<string, unknown> = {}) =>
  fx.call('POST', '/v1/lots', fx.tokens.operator, {
    owner_party_id: ownerId, commodity_id: POTATO_ID, rate_plan_id: ratePlanId, chamber_id: CHAMBER_A, quantity_bags: 5, ...extra,
  });

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  // Plans point at their client and lots point at their plan: unlink, drop the lots, then the plans.
  await prisma.ratePlan.updateMany({ where: { id: { in: plans } }, data: { partyId: null } });
  await fx.cleanup(prisma);
  await prisma.ratePlan.deleteMany({ where: { id: { in: plans } } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a rate agreed with one client', () => {
  it('is saved with the client and listed with his name', async () => {
    const client = await fx.party('Rate Client');
    const p = await plan({ party_id: client });
    expect(p).toMatchObject({ party_id: client, party_name: 'Rate Client' });
    const listed = (await fx.call('GET', '/v1/rate-plans', fx.tokens.owner)).body.data.find((x: { id: string }) => x.id === p.id);
    expect(listed.party_id).toBe(client);
    // The store's ordinary rate names nobody.
    expect((await plan({})).party_id).toBeNull();
  });

  it("prices that client's lots and is refused for anyone else's", async () => {
    const client = await fx.party('Own Rate Client');
    const other = await fx.party('Other Client');
    const p = await plan({ party_id: client });

    expect((await arrive(client, p.id)).status).toBe(201);
    const refused = await arrive(other, p.id);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toMatch(/another client/i);
    // A lot stored by someone else but billed to the client may use the client's rate.
    expect((await arrive(other, p.id, { billing_party_id: client })).status).toBe(201);
  });

  it('cannot be moved to another client once lots are stored on it', async () => {
    const client = await fx.party('Fixed Rate Client');
    const other = await fx.party('Second Client');
    const p = await plan({ party_id: client });
    // Free to change while unused.
    expect((await fx.call('PATCH', `/v1/rate-plans/${p.id}`, fx.tokens.owner, { party_id: other })).status).toBe(200);
    expect((await arrive(other, p.id)).status).toBe(201);
    const moved = await fx.call('PATCH', `/v1/rate-plans/${p.id}`, fx.tokens.owner, { party_id: client });
    expect(moved.status).toBe(400);
  });
});

describe('a new rate from today (docs/32 section 2.5)', () => {
  it('makes a new plan for new arrivals and leaves stored lots on the price they arrived under', async () => {
    const client = await fx.party('New Rate Client');
    const old = await plan({});
    const stored = await arrive(client, old.id);
    expect(stored.status).toBe(201);

    // The price of a plan in use cannot be edited…
    expect((await fx.call('PATCH', `/v1/rate-plans/${old.id}`, fx.tokens.owner, { rate_amount_pkr: 95 })).status).toBe(400);
    // …it is replaced: a copy at the new price, the old one closed to new arrivals.
    const r = await fx.call('POST', `/v1/rate-plans/${old.id}/new-rate`, fx.tokens.owner, { rate_amount_pkr: 95 });
    expect(r.status).toBe(201);
    plans.push(r.body.data.id);
    expect(r.body.data).toMatchObject({ rate_amount_pkr: 95, rate_type: 'MONTHLY_PER_BAG', is_active: true });

    const oldNow = (await fx.call('GET', `/v1/rate-plans/${old.id}`, fx.tokens.owner)).body.data;
    expect(oldNow).toMatchObject({ rate_amount_pkr: 80, is_active: false });
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: stored.body.data.id } })).ratePlanId).toBe(old.id);

    // New arrivals take the new plan; the old one is refused.
    expect((await arrive(client, r.body.data.id)).status).toBe(201);
    expect((await arrive(client, old.id)).status).toBe(400);
    // The same price again, or a plan already closed, is refused.
    expect((await fx.call('POST', `/v1/rate-plans/${old.id}/new-rate`, fx.tokens.owner, { rate_amount_pkr: 99 })).status).toBe(400);
    expect((await fx.call('POST', `/v1/rate-plans/${r.body.data.id}/new-rate`, fx.tokens.owner, { rate_amount_pkr: 95 })).status).toBe(400);
  });
});
