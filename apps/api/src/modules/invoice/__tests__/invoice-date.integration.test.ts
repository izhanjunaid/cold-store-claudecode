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

// docs/25 R-01: a supplier has no receivable, so a draft billed to one could never be
// finalized — and an unfinalizable draft dated in a month stops that month closing.
describe('no invoice is drafted for a supplier', () => {
  const lotFor = (partyId: string, billing?: string) =>
    fx.call('POST', '/v1/lots', fx.tokens.operator, {
      owner_party_id: partyId, ...(billing ? { billing_party_id: billing } : {}),
      commodity_id: '00000000-0000-0000-0000-000000000100',
      rate_plan_id: '00000000-0000-0000-0000-000000000501', chamber_id: '00000000-0000-0000-0000-000000000200',
      quantity_bags: 5, accepted_weight_kg: 100, inbound_date: '2026-07-01',
    });

  // Stored produce is billed to its owner, so a lot belongs to customers only.
  it('a supplier cannot own a lot, be billed for one, or receive one by transfer', async () => {
    const supplierId = await fx.party('Supplier Owner', 'SUPPLIER');
    const customerId = await fx.party('Customer Owner');
    const owned = await lotFor(supplierId);
    expect(owned.status).toBe(400);
    expect(owned.body.error.field).toBe('owner_party_id');
    const billed = await lotFor(customerId, supplierId);
    expect(billed.status).toBe(400);
    expect(billed.body.error.field).toBe('billing_party_id');

    const lot = await lotFor(customerId);
    expect(lot.status).toBe(201);
    const transfer = await fx.call('POST', `/v1/lots/${lot.body.data.id}/transfer`, fx.tokens.manager, {
      transfer_type: 'FULL', to_party_id: supplierId, effective_date: '2026-07-05',
    });
    expect(transfer.status).toBe(400);
    expect(transfer.body.error.field).toBe('to_party_id');
  });

  it('refuses the dispatch of a lot whose owner has since become a supplier', async () => {
    const supplierId = await fx.party('Supplier With A Lot');
    const lot = await lotFor(supplierId);
    expect(lot.status).toBe(201);
    // Allowed: the party has no entries yet, so its type (and account) can still change.
    const retyped = await fx.call('PATCH', `/v1/parties/${supplierId}`, fx.tokens.owner, { party_type: 'SUPPLIER' });
    expect(retyped.status).toBe(200);
    const ob = await fx.call('POST', '/v1/outbound-events', fx.tokens.operator, {
      lot_id: lot.body.data.id, withdrawal_type: 'FULL', quantity_withdrawn_bags: 5, outbound_date: '2026-07-10',
    });
    await fx.call('PATCH', `/v1/outbound-events/${ob.body.data.id}/weight`, fx.tokens.operator, { outbound_weight_kg: 98 });
    const fin = await fx.call('POST', `/v1/outbound-events/${ob.body.data.id}/finalize`, fx.tokens.manager, {});
    expect(fin.status).toBe(400);
    expect(await prisma.invoice.count({ where: { billingPartyId: supplierId } })).toBe(0);
  });
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
