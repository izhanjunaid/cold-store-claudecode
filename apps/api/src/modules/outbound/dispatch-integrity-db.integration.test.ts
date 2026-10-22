/**
 * Migration 0038 — the database-level half of the dispatch integrity fixes.
 * Raw SQL on purpose: these rules must hold for writes that bypass the services.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { withGuardsDisabled } from '../../test/financial-guards';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let operatorToken: string;
let operatorId: string;
let ownerPartyId: string;
const createdLots: string[] = [];

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    if (createdLots.length === 0) return;
    await prisma.gatePass.deleteMany({ where: { facilityId: TEST_FACILITY_ID, vehicleNumber: 'DBTEST-0038' } });
    await prisma.outboundEvent.deleteMany({ where: { lotId: { in: createdLots } } });
    await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: createdLots } } });
    await prisma.lot.deleteMany({ where: { id: { in: createdLots } } });
  });
}

async function createLot(quantity: number) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN,
      chamber_id: CHAMBER_A,
      quantity_bags: quantity,
      accepted_weight_kg: quantity * 20,
    },
  });
  expect(res.statusCode).toBe(201);
  const lot = JSON.parse(res.body).data as { id: string };
  createdLots.push(lot.id);
  return lot;
}

beforeAll(async () => {
  app = await getTestApp();
  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  operatorId = op.user.id;
  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: 'DB Integrity Farmer 0038', party_type: 'FARMER', phone_primary: '03009380001' },
  });
  expect(party.statusCode).toBe(201);
  ownerPartyId = JSON.parse(party.body).data.id;
});

afterAll(async () => {
  await cleanup();
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: ownerPartyId } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('0038 — dispatch integrity at the database', () => {
  it('refuses a lot balance below zero, whatever the writer', async () => {
    const lot = await createLot(10);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE lots SET current_balance_bags = -1 WHERE id = $1::uuid`, lot.id),
    ).rejects.toThrow(/lots_current_balance_nonnegative/);
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(after.currentBalanceBags).toBe(10);
  });

  it('a deleted gate pass releases its withdrawals (ON DELETE SET NULL), so cleanup order never matters', async () => {
    const lot = await createLot(20);
    const ob = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: { lot_id: lot.id, withdrawal_type: 'PARTIAL', quantity_withdrawn_bags: 5, outbound_date: '2026-04-20' },
    });
    expect(ob.statusCode).toBe(201);
    const outboundId = JSON.parse(ob.body).data.id as string;

    const pass = await prisma.gatePass.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        passNumber: 'GP-DBTEST-0038',
        direction: 'INWARD',
        vehicleNumber: 'DBTEST-0038',
        status: 'ARRIVED',
        createdBy: operatorId,
      },
    });
    await prisma.outboundEvent.update({ where: { id: outboundId }, data: { gatePassId: pass.id } });

    await withGuardsDisabled(prisma, async () => {
      await prisma.gatePass.delete({ where: { id: pass.id } });
    });
    const after = await prisma.outboundEvent.findUniqueOrThrow({ where: { id: outboundId } });
    expect(after.gatePassId).toBeNull();
  });

  it('audits the stock and gate tables, and the test guard toggle switches those triggers off', async () => {
    const lot = await createLot(7);
    const rows = await prisma.$queryRawUnsafe<{ action: string }[]>(
      `SELECT action::text AS action FROM audit_log WHERE table_name = 'lots' AND record_id = $1::uuid`,
      lot.id,
    );
    expect(rows.map((r) => r.action)).toContain('INSERT');

    const state = async () =>
      prisma.$queryRawUnsafe<{ tgname: string; tgenabled: string }[]>(
        `SELECT tgname, tgenabled FROM pg_trigger
          WHERE tgname IN ('audit_lots', 'audit_outbound_events', 'audit_gate_passes', 'audit_parties')
          ORDER BY tgname`,
      );
    expect((await state()).map((t) => t.tgname)).toEqual([
      'audit_gate_passes',
      'audit_lots',
      'audit_outbound_events',
      'audit_parties',
    ]);
    await withGuardsDisabled(prisma, async () => {
      expect((await state()).every((t) => t.tgenabled === 'D')).toBe(true);
    });
    expect((await state()).every((t) => t.tgenabled === 'O')).toBe(true);
  });
});
