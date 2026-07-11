import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

// Mock PDF rendering so tests don't require Chromium
vi.mock('../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
  renderPlacementSlip: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slip\n')),
  renderPlacementSlipHtml: vi.fn().mockReturnValue('<html>slip</html>'),
  renderRackLabels: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 labels\n')),
  renderRackLabelsHtml: vi.fn().mockReturnValue('<html>labels</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const APPLE_ID = '00000000-0000-0000-0000-000000000101';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200'; // unrestricted, 1000 bags
const CHAMBER_B = '00000000-0000-0000-0000-000000000201'; // POTATO-only, 500 bags
const CHAMBER_C = '00000000-0000-0000-0000-000000000202'; // tiny, 10 bags
const RACK_A1 = '00000000-0000-0000-0000-000000000210'; // Chamber A, R-1, 400
const RACK_A2 = '00000000-0000-0000-0000-000000000211'; // Chamber A, R-2, 400
const RACK_B1 = '00000000-0000-0000-0000-000000000212'; // Chamber B, R-1, 250
const RACK_AX = '00000000-0000-0000-0000-000000000213'; // Chamber A, inactive
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

let app: FastifyInstance;
let ownerToken: string;
let operatorToken: string;
let managerToken: string;
let ownerPartyId: string;
let buyerPartyId: string;

async function createLot(overrides: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN,
      chamber_id: CHAMBER_A,
      quantity_bags: 100,
      accepted_weight_kg: 2000,
      marka: 'GH-TEST',
      ...overrides,
    },
  });
  return res;
}

async function cleanLots() {
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanLots();

  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;

  const partyRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: 'Placement Farmer', party_type: 'FARMER', phone_primary: '03009200001' },
  });
  ownerPartyId = JSON.parse(partyRes.body).data.id;

  const buyerRes = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: 'Placement Buyer', party_type: 'BUYER', phone_primary: '03009200002' },
  });
  buyerPartyId = JSON.parse(buyerRes.body).data.id;
});

afterAll(async () => {
  await cleanLots();
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Lot creation with placements', () => {
  it('creates a lot split across two racks and reads back placements', async () => {
    const res = await createLot({
      quantity_bags: 500,
      placements: [
        { rack_id: RACK_A1, bags: 300 },
        { rack_id: RACK_A2, bags: 200 },
      ],
    });
    expect(res.statusCode).toBe(201);
    const lot = JSON.parse(res.body).data;

    const pRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lot.id}/placements`,
      headers: authHeaders(operatorToken),
    });
    expect(pRes.statusCode).toBe(200);
    const p = JSON.parse(pRes.body).data;
    expect(p.chamber_id).toBe(CHAMBER_A);
    expect(p.current_balance_bags).toBe(500);
    expect(p.unplaced_bags).toBe(0);
    expect(p.placements).toHaveLength(2);
    const r1 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    expect(r1.bags).toBe(300);
    expect(r1.rack_name).toBe('R-1');
  });

  it('rejects placements summing over lot quantity', async () => {
    const res = await createLot({
      quantity_bags: 100,
      placements: [
        { rack_id: RACK_A1, bags: 80 },
        { rack_id: RACK_A2, bags: 30 },
      ],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a rack belonging to a different chamber', async () => {
    const res = await createLot({
      quantity_bags: 100,
      placements: [{ rack_id: RACK_B1, bags: 100 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an inactive rack', async () => {
    const res = await createLot({
      quantity_bags: 100,
      placements: [{ rack_id: RACK_AX, bags: 100 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('over-filling a rack warns but does not block', async () => {
    // RACK_A1 already holds 300 from the first test; its capacity is 400.
    const res = await createLot({
      quantity_bags: 200,
      placements: [{ rack_id: RACK_A1, bags: 200 }],
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.warnings ?? body.warnings).toBeDefined();
    const warnings: string[] = body.data.warnings ?? body.warnings;
    expect(warnings.some((w) => w.includes('R-1'))).toBe(true);
  });

  it('lot without placements reports everything unplaced', async () => {
    const res = await createLot({ quantity_bags: 60 });
    expect(res.statusCode).toBe(201);
    const lot = JSON.parse(res.body).data;
    const pRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lot.id}/placements`,
      headers: authHeaders(operatorToken),
    });
    const p = JSON.parse(pRes.body).data;
    expect(p.placements).toHaveLength(0);
    expect(p.unplaced_bags).toBe(60);
  });
});

describe('PUT /v1/lots/:id/placements', () => {
  let lotId: string;

  beforeAll(async () => {
    await cleanLots();
    const res = await createLot({ quantity_bags: 400 });
    lotId = JSON.parse(res.body).data.id;
  });

  it('sets the full allocation and logs PLACEMENT movements', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
      payload: {
        placements: [
          { rack_id: RACK_A1, bags: 250 },
          { rack_id: RACK_A2, bags: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).data;
    expect(p.unplaced_bags).toBe(50);

    const mRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/movements`,
      headers: authHeaders(operatorToken),
    });
    expect(mRes.statusCode).toBe(200);
    const movements = JSON.parse(mRes.body).data;
    expect(movements.length).toBeGreaterThanOrEqual(2);
    expect(movements.every((m: { movement_type: string }) => m.movement_type === 'PLACEMENT')).toBe(true);
    const toA1 = movements.find((m: { to_rack_id: string | null }) => m.to_rack_id === RACK_A1);
    expect(toA1.bags).toBe(250);
    expect(toA1.to_rack_name).toBe('R-1');
    expect(toA1.moved_by_name).toBeTruthy();
  });

  it('rejects allocation exceeding current balance', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
      payload: { placements: [{ rack_id: RACK_A1, bags: 401 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate rack rows in one request', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
      payload: {
        placements: [
          { rack_id: RACK_A1, bags: 100 },
          { rack_id: RACK_A1, bags: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /v1/lots/:id/move', () => {
  let lotId: string;

  beforeAll(async () => {
    await cleanLots();
    const res = await createLot({
      quantity_bags: 300,
      placements: [{ rack_id: RACK_A1, bags: 300 }],
    });
    lotId = JSON.parse(res.body).data.id;
  });

  it('RACK move — partial move between racks updates placements and logs RACK_TRANSFER', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'RACK', from_rack_id: RACK_A1, to_rack_id: RACK_A2, bags: 120, reason: 'rebalance' },
    });
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).data;
    const a1 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    const a2 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A2);
    expect(a1.bags).toBe(180);
    expect(a2.bags).toBe(120);

    const mRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/movements`,
      headers: authHeaders(operatorToken),
    });
    const movements = JSON.parse(mRes.body).data;
    const rackMove = movements.find((m: { movement_type: string }) => m.movement_type === 'RACK_TRANSFER');
    expect(rackMove).toBeDefined();
    expect(rackMove.bags).toBe(120);
    expect(rackMove.from_rack_id).toBe(RACK_A1);
    expect(rackMove.to_rack_id).toBe(RACK_A2);
    expect(rackMove.reason).toBe('rebalance');
  });

  it('RACK move — cannot move more bags than sit on the source rack', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'RACK', from_rack_id: RACK_A1, to_rack_id: RACK_A2, bags: 500 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('RACK move — destination rack must be in the lot room', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'RACK', from_rack_id: RACK_A1, to_rack_id: RACK_B1, bags: 10 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ROOM move — whole lot moves to another room, placements cleared, ROOM_TRANSFER logged', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'ROOM', to_chamber_id: CHAMBER_B, reason: 'consolidation' },
    });
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).data;
    expect(p.chamber_id).toBe(CHAMBER_B);
    expect(p.placements).toHaveLength(0);
    expect(p.unplaced_bags).toBe(300);

    const lotRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}`,
      headers: authHeaders(operatorToken),
    });
    expect(JSON.parse(lotRes.body).data.chamber_id).toBe(CHAMBER_B);

    const mRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/movements`,
      headers: authHeaders(operatorToken),
    });
    const movements = JSON.parse(mRes.body).data;
    const roomMove = movements.find((m: { movement_type: string }) => m.movement_type === 'ROOM_TRANSFER');
    expect(roomMove).toBeDefined();
    expect(roomMove.bags).toBe(300);
    expect(roomMove.from_chamber_id).toBe(CHAMBER_A);
    expect(roomMove.to_chamber_id).toBe(CHAMBER_B);
    expect(roomMove.from_chamber_name).toBeTruthy();
    expect(roomMove.to_chamber_name).toBeTruthy();
  });

  it('ROOM move — can land directly on destination racks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: {
        type: 'ROOM',
        to_chamber_id: CHAMBER_A,
        placements: [{ rack_id: RACK_A2, bags: 300 }],
      },
    });
    expect(res.statusCode).toBe(200);
    const p = JSON.parse(res.body).data;
    expect(p.chamber_id).toBe(CHAMBER_A);
    expect(p.placements).toHaveLength(1);
    expect(p.unplaced_bags).toBe(0);
  });

  it('ROOM move — destination hard-capacity is enforced', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'ROOM', to_chamber_id: CHAMBER_C },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('CHAMBER_CAPACITY_EXCEEDED');
  });

  it('ROOM move — commodity restriction is enforced', async () => {
    const appleRes = await createLot({ commodity_id: APPLE_ID, quantity_bags: 50 });
    expect(appleRes.statusCode).toBe(201);
    const appleLotId = JSON.parse(appleRes.body).data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${appleLotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'ROOM', to_chamber_id: CHAMBER_B },
    });
    expect(res.statusCode).toBe(400);
  });

  it('ROOM move — no-op move to the same room is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/move`,
      headers: authHeaders(operatorToken),
      payload: { type: 'ROOM', to_chamber_id: CHAMBER_A },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('Withdrawal placement reconciliation', () => {
  let lotId: string;

  async function withdrawAndFinalize(
    quantity: number,
    type: 'FULL' | 'PARTIAL',
    pickedFrom?: { rack_id: string; bags: number }[],
  ) {
    const obRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lotId,
        withdrawal_type: type,
        quantity_withdrawn_bags: quantity,
        outbound_date: new Date().toISOString().slice(0, 10),
      },
    });
    expect(obRes.statusCode).toBe(201);
    const obId = JSON.parse(obRes.body).data.id;

    const wRes = await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${obId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: quantity * 20 },
    });
    expect(wRes.statusCode).toBe(200);

    const fRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${obId}/finalize`,
      headers: authHeaders(managerToken),
      payload: pickedFrom ? { picked_from: pickedFrom } : {},
    });
    expect(fRes.statusCode).toBe(200);
    return obId;
  }

  beforeAll(async () => {
    await cleanLots();
    const res = await createLot({
      quantity_bags: 500,
      placements: [
        { rack_id: RACK_A1, bags: 300 },
        { rack_id: RACK_A2, bags: 200 },
      ],
    });
    lotId = JSON.parse(res.body).data.id;
  });

  it('picked_from trims exactly the named racks and logs WITHDRAWAL_PICK', async () => {
    await withdrawAndFinalize(100, 'PARTIAL', [{ rack_id: RACK_A2, bags: 100 }]);

    const pRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
    });
    const p = JSON.parse(pRes.body).data;
    expect(p.current_balance_bags).toBe(400);
    const a1 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    const a2 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A2);
    expect(a1.bags).toBe(300);
    expect(a2.bags).toBe(100);
    expect(p.unplaced_bags).toBe(0);

    const mRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/movements`,
      headers: authHeaders(operatorToken),
    });
    const movements = JSON.parse(mRes.body).data;
    const pick = movements.find((m: { movement_type: string }) => m.movement_type === 'WITHDRAWAL_PICK');
    expect(pick).toBeDefined();
    expect(pick.bags).toBe(100);
    expect(pick.from_rack_id).toBe(RACK_A2);
  });

  it('without picked_from, auto-trim reduces the largest placements first', async () => {
    // Placements now: A1=300, A2=100; balance 400. Withdraw 150 with no picks.
    // Auto-trim: placed total 400 > new balance 250 → trim 150 from A1 (largest).
    await withdrawAndFinalize(150, 'PARTIAL');

    const pRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
    });
    const p = JSON.parse(pRes.body).data;
    expect(p.current_balance_bags).toBe(250);
    const a1 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    const a2 = p.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A2);
    expect(a1.bags).toBe(150);
    expect(a2.bags).toBe(100);
    expect(p.unplaced_bags).toBe(0);
  });

  it('picked_from must not exceed the withdrawn quantity or rack placement', async () => {
    const obRes = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lotId,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 50,
        outbound_date: new Date().toISOString().slice(0, 10),
      },
    });
    const obId = JSON.parse(obRes.body).data.id;
    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${obId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: 1000 },
    });
    const fRes = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${obId}/finalize`,
      headers: authHeaders(managerToken),
      payload: { picked_from: [{ rack_id: RACK_A1, bags: 60 }] },
    });
    expect(fRes.statusCode).toBe(400);
  });

  it('FULL withdrawal clears all placements', async () => {
    // Balance 250 (A1=150, A2=100). Finalize the pending 50-bag withdrawal
    // first is not needed — it was rejected, so balance is still 250.
    await withdrawAndFinalize(250, 'FULL');

    const pRes = await app.inject({
      method: 'GET',
      url: `/v1/lots/${lotId}/placements`,
      headers: authHeaders(operatorToken),
    });
    const p = JSON.parse(pRes.body).data;
    expect(p.current_balance_bags).toBe(0);
    expect(p.placements).toHaveLength(0);
  });
});

describe('Ownership transfer placement mirroring', () => {
  let parentLotId: string;

  beforeAll(async () => {
    await cleanLots();
    const res = await createLot({
      quantity_bags: 400,
      placements: [
        { rack_id: RACK_A1, bags: 250 },
        { rack_id: RACK_A2, bags: 150 },
      ],
    });
    parentLotId = JSON.parse(res.body).data.id;
  });

  it('partial transfer mirrors trimmed placements onto the child lot', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/lots/${parentLotId}/transfer`,
      headers: authHeaders(managerToken),
      payload: {
        transfer_type: 'PARTIAL',
        to_party_id: buyerPartyId,
        quantity_bags: 100,
        effective_date: new Date().toISOString().slice(0, 10),
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body).data;
    const childLotId = body.child_lot_id;
    expect(childLotId).toBeTruthy();

    // Parent: trimmed largest-first → A1 250-100=150, A2 stays 150.
    const parentP = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/v1/lots/${parentLotId}/placements`,
        headers: authHeaders(operatorToken),
      })).body,
    ).data;
    expect(parentP.current_balance_bags).toBe(300);
    const pa1 = parentP.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    const pa2 = parentP.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A2);
    expect(pa1.bags).toBe(150);
    expect(pa2.bags).toBe(150);
    expect(parentP.unplaced_bags).toBe(0);

    // Child: mirrored placements on the same physical racks.
    const childP = JSON.parse(
      (await app.inject({
        method: 'GET',
        url: `/v1/lots/${childLotId}/placements`,
        headers: authHeaders(operatorToken),
      })).body,
    ).data;
    expect(childP.current_balance_bags).toBe(100);
    const ca1 = childP.placements.find((x: { rack_id: string }) => x.rack_id === RACK_A1);
    expect(ca1.bags).toBe(100);
    expect(childP.unplaced_bags).toBe(0);
  });
});
