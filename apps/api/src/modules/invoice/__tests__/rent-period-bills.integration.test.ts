import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { addDays, businessDate } from '@coldchain/shared';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { billingFixture, POTATO_ID, CHAMBER_A, RATE_PLAN_SEASONAL } from './billing-fixture';

/**
 * Rent billed for a period with the goods still in the room (docs/32 section 2.6), and
 * the store's choice of what happens to rent at a change of owner. The rule under test:
 * however a stay is billed in parts, the parts add up to what one bill at the end would
 * have been. No unit-day is billed twice and none is missed.
 */
const RATE_PLAN_MONTHLY = '00000000-0000-0000-0000-000000000500'; // Rs 100 per unit per month
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
const today = businessDate();
const ago = (days: number) => addDays(today, -days);

async function lot(partyId: string, ratePlanId: string, units: number, inbound: string) {
  const r = await fx.call('POST', '/v1/lots', fx.tokens.operator, {
    owner_party_id: partyId, commodity_id: POTATO_ID, rate_plan_id: ratePlanId, chamber_id: CHAMBER_A,
    quantity_bags: units, inbound_date: inbound,
  });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

async function billRent(body: Record<string, unknown>) {
  return fx.call('POST', '/v1/billing/rent-bills', fx.tokens.manager, body);
}

/** Withdraw and dispatch; returns the storage amount of the withdrawal's bill and who it is billed to. */
async function withdraw(lotId: string, units: number, date: string) {
  const balance = (await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags;
  const ob = await fx.call('POST', '/v1/outbound-events', fx.tokens.manager, {
    lot_id: lotId, withdrawal_type: units === balance ? 'FULL' : 'PARTIAL', quantity_withdrawn_bags: units, outbound_date: date,
  });
  expect(ob.status).toBe(201);
  const fin = await fx.call('POST', `/v1/outbound-events/${ob.body.data.id}/finalize`, fx.tokens.manager, {});
  expect(fin.status).toBe(200);
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: fin.body.data.invoice_id } });
  return { subTotal: Number(inv.subTotalPkr), billingPartyId: inv.billingPartyId, id: inv.id };
}

const subTotal = async (invoiceId: string) => Number((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).subTotalPkr);

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  await fx.call('PATCH', '/v1/facilities/me', fx.tokens.owner, { settings: { transfer_rent_rule: 'SELLER_BILLED' } });
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
});

describe('rent billed for a period', () => {
  it('monthly rent billed in parts adds up to one bill at the end', async () => {
    const party = await fx.party('Period Bill Party');
    const id = await lot(party, RATE_PLAN_MONTHLY, 10, ago(70));

    // 30 days in: one month. A DRAFT bill, marked as a period bill, with the goods still in.
    const first = await billRent({ lot_id: id, as_of_date: ago(40) });
    expect(first.status).toBe(201);
    expect(first.body.data.invoices).toHaveLength(1);
    expect(first.body.data.invoices[0].total_pkr).toBe(10 * 100);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: first.body.data.invoices[0].invoice_id } });
    expect(inv).toMatchObject({ status: 'DRAFT', rentPeriodBill: true, outboundEventId: null, billingPartyId: party });
    expect((await prisma.lot.findUniqueOrThrow({ where: { id } })).currentBalanceBags).toBe(10);

    // 35 days in: the second month has begun, so it is billed; 5 days later nothing more is owed.
    const second = await billRent({ lot_id: id, as_of_date: ago(35) });
    expect(second.body.data.invoices[0].total_pkr).toBe(10 * 100);
    expect((await billRent({ lot_id: id, as_of_date: ago(30) })).body.data.invoices).toEqual([]);

    // Out after 70 days: three months in all, two already billed.
    const out = await withdraw(id, 10, today);
    expect(out.subTotal).toBe(10 * 100);
    // One bill at the end would have been 10 x 3 months x Rs 100.
    expect(first.body.data.invoices[0].total_pkr + second.body.data.invoices[0].total_pkr + out.subTotal).toBe(10 * 3 * 100);
  });

  it('a period bill that is cancelled is owed again', async () => {
    const party = await fx.party('Cancelled Bill Party');
    const id = await lot(party, RATE_PLAN_MONTHLY, 5, ago(40));
    const bill = await billRent({ lot_id: id, as_of_date: ago(10) }); // 30 days: 1 month
    expect(bill.body.data.invoices[0].total_pkr).toBe(500);
    await prisma.invoice.update({ where: { id: bill.body.data.invoices[0].invoice_id }, data: { status: 'VOID' } });
    expect((await withdraw(id, 5, today)).subTotal).toBe(5 * 2 * 100); // 40 days: 2 months, nothing billed
  });

  it('a partial withdrawal after a period bill pays only what its units still owe', async () => {
    const party = await fx.party('Partial After Bill Party');
    const id = await lot(party, RATE_PLAN_MONTHLY, 10, ago(70));
    await billRent({ lot_id: id, as_of_date: ago(40) }); // 1 month on all 10
    const some = await withdraw(id, 4, today); // 3 months - 1 billed = 2, on 4 units
    expect(some.subTotal).toBe(4 * 2 * 100);
    const next = await billRent({ lot_id: id, as_of_date: today }); // the 6 left: 3 - 1 = 2 months
    expect(next.body.data.invoices[0].total_pkr).toBe(6 * 2 * 100);
  });

  it('season rent billed at the season end is not billed again when the goods leave', async () => {
    const party = await fx.party('Season End Party');
    const id = await lot(party, RATE_PLAN_SEASONAL, 20, ago(60)); // Rs 50 per unit for the season
    const bill = await billRent({ lot_id: id, as_of_date: ago(1) });
    expect(bill.body.data.invoices[0].total_pkr).toBe(20 * 50);
    expect((await billRent({ lot_id: id, as_of_date: today })).body.data.invoices).toEqual([]);
    expect((await withdraw(id, 20, today)).subTotal).toBe(0);
  });

  it('bills every lot of a client at once, and refuses a future date', async () => {
    const party = await fx.party('Khata Party');
    await lot(party, RATE_PLAN_MONTHLY, 3, ago(20));
    await lot(party, RATE_PLAN_MONTHLY, 7, ago(50));
    const r = await billRent({ party_id: party, as_of_date: today });
    expect(r.status).toBe(201);
    expect(r.body.data.invoices.map((i: { total_pkr: number }) => i.total_pkr).sort((a: number, b: number) => a - b)).toEqual([3 * 100, 7 * 2 * 100]);
    expect((await billRent({ party_id: party, as_of_date: addDays(today, 1) })).status).toBe(400);
    // Only a manager bills.
    expect((await fx.call('POST', '/v1/billing/rent-bills', fx.tokens.operator, { party_id: party, as_of_date: today })).status).toBe(403);
  });
});

describe('rent at a change of owner: the store chooses', () => {
  it('SELLER_BILLED (the default): the seller pays up to the day, less what period bills charged', async () => {
    const seller = await fx.party('Seller A');
    const buyer = await fx.party('Buyer A');
    const id = await lot(seller, RATE_PLAN_MONTHLY, 10, ago(70));
    await billRent({ lot_id: id, as_of_date: ago(40) }); // 1 month billed on all 10

    const t = await fx.call('POST', `/v1/lots/${id}/transfer`, fx.tokens.manager, {
      transfer_type: 'PARTIAL', to_party_id: buyer, quantity_bags: 4, effective_date: ago(20),
    });
    expect(t.status).toBe(201);
    // 50 days to the transfer: 2 months, 1 already billed, on the 4 units sold.
    expect(await subTotal(t.body.data.accrued_invoice_id)).toBe(4 * 100);
    // The buyer's rent starts at the transfer: 20 days, 1 month.
    const bought = await withdraw(t.body.data.child_lot_id, 4, today);
    expect(bought).toMatchObject({ subTotal: 4 * 100, billingPartyId: buyer });
  });

  it('BUYER_TAKES_OVER: no bill at the transfer; the buyer pays all the rent not yet billed', async () => {
    expect((await fx.call('PATCH', '/v1/facilities/me', fx.tokens.owner, { settings: { transfer_rent_rule: 'BUYER_TAKES_OVER' } })).status).toBe(200);
    const seller = await fx.party('Seller B');
    const buyer = await fx.party('Buyer B');
    const id = await lot(seller, RATE_PLAN_MONTHLY, 10, ago(70));
    await billRent({ lot_id: id, as_of_date: ago(40) }); // the seller is billed 1 month on all 10

    const part = await fx.call('POST', `/v1/lots/${id}/transfer`, fx.tokens.manager, {
      transfer_type: 'PARTIAL', to_party_id: buyer, quantity_bags: 4, effective_date: today,
    });
    expect(part.status).toBe(201);
    expect(part.body.data.accrued_invoice_id).toBeNull();

    // The 4 units carry their stay with them: 70 days = 3 months, 1 already billed.
    const bought = await withdraw(part.body.data.child_lot_id, 4, today);
    expect(bought).toMatchObject({ subTotal: 4 * 2 * 100, billingPartyId: buyer });

    // The same for a whole lot: the 6 left go to the buyer, who pays their 2 unbilled months.
    const full = await fx.call('POST', `/v1/lots/${id}/transfer`, fx.tokens.manager, {
      transfer_type: 'FULL', to_party_id: buyer, effective_date: today,
    });
    expect(full.status).toBe(201);
    expect(full.body.data.accrued_invoice_id).toBeNull();
    const rest = await withdraw(id, 6, today);
    expect(rest).toMatchObject({ subTotal: 6 * 2 * 100, billingPartyId: buyer });
  });
});
