import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { billingFixture } from './billing-fixture';

/**
 * docs/25 R-28: a service line is a catalog entry — the server prices it and
 * names it from the service charge, and its revenue goes to that charge's
 * account. It used to be free text and a typed price, never linked to the
 * catalog, so every service charge landed in 4150 and 4110–4140 were unreachable.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const LOADING = '00000000-0000-0000-0000-000000000650'; // seed: PER_BAG Rs 10, revenue 4110

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
});

describe('service lines come from the catalog (R-28)', () => {
  it('prices and names the line from the service charge, and posts to its revenue account', async () => {
    const partyId = await fx.party('Service Line Party');
    const id = await fx.draftInvoice(partyId, { outbound: '2026-07-20' });

    const add = await fx.call('POST', `/v1/invoices/${id}/lines`, fx.tokens.manager, {
      line_type: 'SERVICE', service_charge_id: LOADING, quantity: 10, unit_price_pkr: 99, description: 'typed',
    });
    expect(add.status).toBe(201);
    const line = add.body.data.line_items.find((l: { line_type: string }) => l.line_type === 'SERVICE');
    expect(line.unit_price_pkr).toBe(10);
    expect(line.amount_pkr).toBe(100);
    expect(line.description).toBe('Loading');
    expect(line.service_charge_id).toBe(LOADING);

    const fin = await fx.call('POST', `/v1/invoices/${id}/finalize`, fx.tokens.manager, {});
    expect(fin.status).toBe(200);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceTable: 'invoices', sourceId: id }, include: { lines: true } });
    expect(Number(je.lines.find((l) => l.accountCode === '4110')!.creditAmount)).toBe(100);
  });

  it('refuses a service line that is not in the catalog', async () => {
    const partyId = await fx.party('Free Text Service Party');
    const id = await fx.draftInvoice(partyId, { outbound: '2026-07-21' });
    const add = await fx.call('POST', `/v1/invoices/${id}/lines`, fx.tokens.manager, {
      line_type: 'SERVICE', description: 'Handling', quantity: 5, unit_price_pkr: 20,
    });
    expect(add.status).toBe(400);
  });
});
