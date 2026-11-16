import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { billingFixture } from './billing-fixture';

/**
 * A store with more bills than PostgreSQL allows bind variables (32,767) in one
 * statement (docs/31 F-0). The aging report and the dashboard used to pass every
 * invoice id in one `IN (...)` and failed with a server error from that size on.
 */
const BILLS = 33_000;
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let partyId: string;
let firstTotal: number;

async function removeBulk() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.$executeRawUnsafe(`UPDATE invoices SET journal_entry_id = NULL WHERE invoice_number LIKE 'INV-BIG-%'`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE entry_number LIKE 'JE-BIG-%')`,
    );
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE entry_number LIKE 'JE-BIG-%'`);
    await prisma.$executeRawUnsafe(`DELETE FROM invoices WHERE invoice_number LIKE 'INV-BIG-%'`);
  });
}

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
  await removeBulk(); // leftovers of an interrupted run
  partyId = await fx.party('Big Store Party');
  const first = await fx.invoice(partyId);
  firstTotal = first.total;
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: first.id } });
  const k = `'${inv.facilityId}'::uuid, '${inv.createdBy}'::uuid`;
  const series = `generate_series(1, ${BILLS}) s`;

  // One transaction: the balance check on journal entries runs at commit.
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`
      INSERT INTO journal_entries (id, facility_id, entry_number, entry_date, entry_type, source_table, source_id,
                                   description, period_month, period_year, created_by)
      SELECT md5('bigje'||s)::uuid, (SELECT x FROM (VALUES (${k})) v(x, y)), 'JE-BIG-'||s, DATE '2026-05-01', 'INVOICE', 'invoices',
             md5('biginv'||s)::uuid, 'Scale test bill', 5, 2026, (SELECT y FROM (VALUES (${k})) v(x, y))
      FROM ${series}`),
    prisma.$executeRawUnsafe(`
      INSERT INTO journal_entry_lines (id, journal_entry_id, line_number, account_code, facility_id, debit_amount, credit_amount, party_id)
      SELECT md5('bigjl'||s||'-'||ln)::uuid, md5('bigje'||s)::uuid, ln, CASE WHEN ln = 1 THEN '1110' ELSE '4010' END,
             '${inv.facilityId}'::uuid, CASE WHEN ln = 1 THEN 100 ELSE 0 END, CASE WHEN ln = 2 THEN 100 ELSE 0 END,
             CASE WHEN ln = 1 THEN '${partyId}'::uuid END
      FROM ${series}, generate_series(1, 2) ln`),
    prisma.$executeRawUnsafe(`
      INSERT INTO invoices (id, facility_id, invoice_number, lot_id, billing_party_id, invoice_date, period_start, period_end,
                            sub_total_pkr, total_pkr, amount_paid_pkr, status, finalized_at, finalized_by, journal_entry_id, created_by)
      SELECT md5('biginv'||s)::uuid, '${inv.facilityId}'::uuid, 'INV-BIG-'||s, '${inv.lotId}'::uuid, '${partyId}'::uuid,
             DATE '2026-05-01', DATE '2026-03-01', DATE '2026-05-01', 100, 100, 0, 'FINALIZED', now(), '${inv.createdBy}'::uuid,
             md5('bigje'||s)::uuid, '${inv.createdBy}'::uuid
      FROM ${series}`),
  ]);
  // A bulk load leaves the planner's statistics saying these tables are as small as
  // they were a moment ago (empty, on a fresh database), and every join over them is
  // then planned as if for a handful of rows. A real store grows row by row and
  // autovacuum keeps the statistics current; a bulk load must refresh them itself.
  await prisma.$executeRawUnsafe('ANALYZE journal_entries, journal_entry_lines, invoices');
}, 900_000);

afterAll(async () => {
  await removeBulk();
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
}, 900_000);

describe('receivables on a big store (docs/31 F-0)', () => {
  it(`ages a client with ${BILLS} open bills and ties to the ledger`, async () => {
    const r = await fx.call('GET', `/v1/reports/receivables-aging?party_id=${partyId}`, fx.tokens.owner);
    expect(r.status).toBe(200);
    expect(r.body.data.net_total_pkr).toBe(firstTotal + BILLS * 100);
    expect(r.body.data.variance_pkr).toBe(0);
  }, 60_000);

  it('the dashboard still opens', async () => {
    const r = await fx.call('GET', '/v1/reports/dashboard', fx.tokens.owner);
    expect(r.status).toBe(200);
    expect(r.body.data.financial.ar_total_pkr).toBeGreaterThanOrEqual(BILLS * 100);
  }, 60_000);
});
