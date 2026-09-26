import { expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@coldchain/db';
import { authHeaders, loginAsRole, TEST_FACILITY_ID } from '../../../test/helpers';
import { withGuardsDisabled } from '../../../test/financial-guards';

/**
 * A billing scenario for the receivables tests: parties, a lot dispatched into a
 * finalized invoice, and a cleanup that removes exactly what the scenario created
 * (other suites share the test facility, so wiping it would race them).
 */
export const POTATO_ID = '00000000-0000-0000-0000-000000000100';
export const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
export const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

type InvoiceOpts = { bags?: number; inbound?: string; outbound?: string; book?: 'PACCI' | 'KATCHI' };

export async function billingFixture(app: FastifyInstance) {
  const tokens = {
    owner: (await loginAsRole(app, 'OWNER')).accessToken,
    manager: (await loginAsRole(app, 'MANAGER')).accessToken,
    accountant: (await loginAsRole(app, 'ACCOUNTANT')).accessToken,
    operator: (await loginAsRole(app, 'OPERATOR')).accessToken,
  };
  const parties: string[] = [];

  async function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) {
    const res = await app.inject({ method, url, headers: authHeaders(token), payload: payload as never });
    return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
  }

  async function party(name: string, partyType = 'FARMER'): Promise<string> {
    const phone = `0300${String(Date.now()).slice(-7)}`;
    const r = await call('POST', '/v1/parties', tokens.operator, {
      name, party_type: partyType, phone_primary: phone, credit_terms_days: 30,
    });
    expect(r.status).toBe(201);
    parties.push(r.body.data.id);
    return r.body.data.id;
  }

  /** Inbound `bags` for the party, dispatch them all, and return the DRAFT invoice id. */
  async function draftInvoice(partyId: string, opts: InvoiceOpts = {}) {
    const bags = opts.bags ?? 10;
    // Only the OWNER may touch the KATCHI book.
    const op = opts.book === 'KATCHI' ? tokens.owner : tokens.operator;
    const mgr = opts.book === 'KATCHI' ? tokens.owner : tokens.manager;
    const lot = await call('POST', '/v1/lots', op, {
      owner_party_id: partyId, commodity_id: POTATO_ID, rate_plan_id: RATE_PLAN_SEASONAL, chamber_id: CHAMBER_A,
      quantity_bags: bags, accepted_weight_kg: bags * 20, inbound_date: opts.inbound ?? '2026-03-01',
      ...(opts.book ? { book_type: opts.book } : {}),
    });
    expect(lot.status).toBe(201);
    const ob = await call('POST', '/v1/outbound-events', op, {
      lot_id: lot.body.data.id, withdrawal_type: 'FULL', quantity_withdrawn_bags: bags,
      outbound_date: opts.outbound ?? '2026-04-01',
    });
    expect(ob.status).toBe(201);
    await call('PATCH', `/v1/outbound-events/${ob.body.data.id}/weight`, op, { outbound_weight_kg: bags * 19.5 });
    const fin = await call('POST', `/v1/outbound-events/${ob.body.data.id}/finalize`, mgr, {});
    expect(fin.status).toBe(200);
    return fin.body.data.invoice_id as string;
  }

  /** A finalized invoice for the party: its id and total. */
  async function invoice(partyId: string, opts: InvoiceOpts = {}) {
    const id = await draftInvoice(partyId, opts);
    const r = await call('POST', `/v1/invoices/${id}/finalize`, opts.book === 'KATCHI' ? tokens.owner : tokens.manager, {});
    expect(r.status).toBe(200);
    return { id, total: Number(r.body.data.total_pkr) as number, invoice: r.body.data };
  }

  async function cleanup(prisma: PrismaClient) {
    if (parties.length === 0) return;
    await withGuardsDisabled(prisma, async () => {
      const where = { facilityId: TEST_FACILITY_ID, partyId: { in: parties } };
      const payments = await prisma.payment.findMany({ where, select: { id: true } });
      const paymentIds = payments.map((p) => p.id);
      const invoices = await prisma.invoice.findMany({
        where: { facilityId: TEST_FACILITY_ID, billingPartyId: { in: parties } },
        select: { id: true, lotId: true, outboundEventId: true },
      });
      const invoiceIds = invoices.map((i) => i.id);
      const lotIds = [...new Set(invoices.map((i) => i.lotId))];
      const entries = await prisma.journalEntry.findMany({
        where: { facilityId: TEST_FACILITY_ID, lines: { some: { partyId: { in: parties } } } },
        select: { id: true },
      });
      const entryIds = entries.map((e) => e.id);
      const loans = await prisma.partyLoan.findMany({ where, select: { id: true } });
      const loanIds = loans.map((l) => l.id);

      await prisma.payment.updateMany({ where: { id: { in: paymentIds } }, data: { journalEntryId: null } });
      await prisma.invoice.updateMany({ where: { id: { in: invoiceIds } }, data: { journalEntryId: null } });
      await prisma.creditNote.updateMany({ where: { originalInvoiceId: { in: invoiceIds } }, data: { journalEntryId: null } });
      await prisma.partyLoan.updateMany({
        where: { id: { in: loanIds } },
        data: { issueJournalEntryId: null, writeOffJournalEntryId: null },
      });
      await prisma.partyLoanRepayment.updateMany({ where: { loanId: { in: loanIds } }, data: { journalEntryId: null } });
      await prisma.journalEntry.updateMany({ where: { id: { in: entryIds } }, data: { reversedById: null } });
      await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: entryIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: entryIds } } });

      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      await prisma.partyLoanRepayment.deleteMany({ where: { loanId: { in: loanIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.partyLoan.deleteMany({ where: { id: { in: loanIds } } });
      await prisma.creditNoteLineItem.deleteMany({ where: { creditNote: { originalInvoiceId: { in: invoiceIds } } } });
      await prisma.creditNote.deleteMany({ where: { originalInvoiceId: { in: invoiceIds } } });
      await prisma.invoice.updateMany({ where: { id: { in: invoiceIds } }, data: { surchargeOfInvoiceId: null } });
      await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await prisma.outboundEvent.deleteMany({ where: { lotId: { in: lotIds } } });
      await prisma.lotRackPlacement.deleteMany({ where: { lotId: { in: lotIds } } });
      await prisma.lotMovement.deleteMany({ where: { lotId: { in: lotIds } } });
      await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: lotIds } } });
      await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
      await prisma.party.deleteMany({ where: { id: { in: parties } } });
    });
  }

  return { tokens, call, party, draftInvoice, invoice, cleanup };
}
