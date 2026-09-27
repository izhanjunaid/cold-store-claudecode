import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { billingFixture } from './billing-fixture';

/**
 * docs/25 R-09: an invoice is dated when the storage it bills ended (the dispatch
 * or transfer), not the day the draft happened to be built — a backdated dispatch
 * used to book its revenue in the wrong month, and a draft whose creation month
 * had since been locked could never be finalized. The date stays editable while
 * the invoice is a draft.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
});

describe('invoice date (R-09)', () => {
  it('is the dispatch date, editable in draft, fixed once finalized', async () => {
    const partyId = await fx.party('Invoice Date Party');
    const id = await fx.draftInvoice(partyId, { outbound: '2026-07-14' });
    const draft = (await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data;
    expect(draft.invoice_date).toBe('2026-07-14');

    const moved = await fx.call('PATCH', `/v1/invoices/${id}`, fx.tokens.manager, { invoice_date: '2026-07-16' });
    expect(moved.status).toBe(200);
    expect(moved.body.data.invoice_date).toBe('2026-07-16');

    // Never before the storage it bills ended.
    expect((await fx.call('PATCH', `/v1/invoices/${id}`, fx.tokens.manager, { invoice_date: '2026-07-10' })).status).toBe(400);

    const fin = await fx.call('POST', `/v1/invoices/${id}/finalize`, fx.tokens.manager, {});
    expect(fin.status).toBe(200);
    expect(fin.body.data.invoice_number).toMatch(/^INV-202607-/);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceTable: 'invoices', sourceId: id } });
    expect(je.entryDate.toISOString().slice(0, 10)).toBe('2026-07-16');
  });
});
