import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { billingFixture, POTATO_ID } from './billing-fixture';

/**
 * A TARIFF_PER_BAG plan end to end: created through the API, used by a lot, billed on
 * withdrawal. The rule itself is exhaustively covered in tariff.test.ts; this proves the
 * wiring — that the stored rule reaches the calculator and the line reads qty × price = amount.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const planIds: string[] = [];

// ½ month first, then whole months, then leftover days at monthly ÷ 30.
const APPLE = { opening: { type: 'BLOCK', days: 15, months_charged: 0.5 } };

async function createPlan(name: string, extra: Record<string, unknown> = {}) {
  const r = await fx.call('POST', '/v1/rate-plans', fx.tokens.manager, {
    name,
    commodity_id: POTATO_ID,
    rate_type: 'TARIFF_PER_BAG',
    rate_amount_pkr: 30,
    min_billing_days: 1,
    tariff: APPLE,
    ...extra,
  });
  if (r.status === 201) planIds.push(r.body.data.id);
  return r;
}

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await prisma.ratePlan.deleteMany({ where: { id: { in: planIds } } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('creating a tariff plan', () => {
  it('stores the rule and echoes it back with defaults filled in', async () => {
    const r = await createPlan('Tariff echo');
    expect(r.status).toBe(201);
    expect(r.body.data.rate_type).toBe('TARIFF_PER_BAG');
    expect(r.body.data.tariff).toMatchObject({
      opening: { type: 'BLOCK', days: 15, months_charged: 0.5 },
      month_counting: 'DAYS_30',
      remainder: { grace_days: 0, mode: 'DAILY' },
    });
  });

  it('refuses a tariff plan with no rule, and a rule on any other rate type', async () => {
    expect((await createPlan('No rule', { tariff: undefined })).status).toBe(400);
    expect((await createPlan('Rule on monthly', { rate_type: 'MONTHLY_PER_BAG' })).status).toBe(400);
  });

  it('refuses combinations that have no meaning', async () => {
    const splitOnThirtyDays = await createPlan('Bad split', {
      tariff: { opening: { type: 'SPLIT_MONTH', split_day: 15 } },
    });
    expect(splitOnThirtyDays.status).toBe(400);
  });

  it('a season fee needs the plan to have a season end', async () => {
    const tariff = { opening: { type: 'SEASON', fee: 120 } };
    expect((await createPlan('Season, no end', { tariff })).status).toBe(400);
    const ok = await createPlan('Season with end', {
      tariff,
      season_start_date: '2026-01-01',
      season_end_date: '2026-03-31',
    });
    expect(ok.status).toBe(201);
  });
});

describe('billing a lot on a tariff plan', () => {
  it('withdrawal bills ½ month + 1 month + 5 days and the line reads qty × price = amount', async () => {
    const plan = await createPlan('Tariff billing');
    const party = await fx.party('Tariff Biller');
    const invoiceId = await fx.draftInvoice(party, {
      bags: 10,
      ratePlanId: plan.body.data.id,
      inbound: '2026-01-01',
      outbound: '2026-02-20', // 50 days
    });
    const inv = (await fx.call('GET', `/v1/invoices/${invoiceId}`, fx.tokens.manager)).body.data;
    const storage = inv.line_items.find((l: { line_type: string }) => l.line_type === 'STORAGE');
    expect(storage.amount_pkr).toBe(500); // 10 bags × (15 + 30 + 5)
    expect(storage.unit_price_pkr).toBe(50);
    expect(storage.quantity).toBe(10);
    expect(storage.description).toContain('½ month + 1 month + 5 days');
  });
});

describe('editing a plan that lots already use', () => {
  it('renaming echoes every field and still succeeds; a real change to the rule or the rate does not', async () => {
    const plan = (await createPlan('Tariff frozen')).body.data;
    await fx.draftInvoice(await fx.party('Tariff Freezer'), { ratePlanId: plan.id, inbound: '2026-01-01', outbound: '2026-01-20' });

    // The edit form sends every field; unchanged values (the Decimal rate, the dates,
    // the rule with its keys in another order) must not count as a rate change.
    const echo = await fx.call('PATCH', `/v1/rate-plans/${plan.id}`, fx.tokens.manager, {
      name: 'Tariff frozen (renamed)',
      rate_amount_pkr: 30,
      min_billing_days: 1,
      season_start_date: null,
      season_end_date: null,
      tariff: {
        remainder: { half_month_days: 15, mode: 'DAILY', grace_days: 0 },
        opening: { months_charged: 0.5, days: 15, type: 'BLOCK' },
        month_counting: 'DAYS_30',
        day_rate: null,
      },
    });
    expect(echo.status).toBe(200);
    expect(echo.body.data.name).toBe('Tariff frozen (renamed)');

    const deactivate = await fx.call('PATCH', `/v1/rate-plans/${plan.id}`, fx.tokens.manager, { is_active: false });
    expect(deactivate.status).toBe(200);

    const rule = await fx.call('PATCH', `/v1/rate-plans/${plan.id}`, fx.tokens.manager, {
      tariff: { opening: { type: 'BLOCK', days: 10, months_charged: 0.5 } },
    });
    expect(rule.status).toBe(400);
    const rate = await fx.call('PATCH', `/v1/rate-plans/${plan.id}`, fx.tokens.manager, { rate_amount_pkr: 31 });
    expect(rate.status).toBe(400);
  });

  it('only a tariff plan can be given a tariff', async () => {
    const r = await fx.call('PATCH', '/v1/rate-plans/00000000-0000-0000-0000-000000000501', fx.tokens.manager, {
      tariff: APPLE,
    });
    expect(r.status).toBe(400);
  });
});
