/**
 * Whole-truck checkout (fast-dispatch C2). A truck is its plate (the gate's rule): every open
 * withdrawal booked on it is checked out in one transaction — one bill and JE-01 per lot, one
 * receipt per (billing party, book) — or nothing is. Every refusal asserts nothing was written;
 * every race asserts the loser (CLAUDE.md).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { withGuardsDisabled } from '../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import { addDays, businessDate } from '@coldchain/shared';
import type { FastifyInstance } from 'fastify';

// The HTML renderers are real (the load slip's content is asserted); only the Chromium steps are mocked.
vi.mock('../pdf/pdf.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/pdf.service')>()),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 inv\n')),
  renderLoadSlip: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slip\n')),
  renderGatePassReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 gp\n')),
}));

// Each case books, weighs, previews and checks out a whole truck (some then release it at the
// gate): more than the 15 s default on a loaded machine.
vi.setConfig({ testTimeout: 45_000 });

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let operatorToken: string;
let securityToken: string;
let partyA: string;
let partyB: string;
let originalSettings: unknown;

type Res = { statusCode: number; body: string };
const code = (r: Res) => JSON.parse(r.body).error?.code as string | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = <T = any>(r: Res) => JSON.parse(r.body).data as T;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.gatePass.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.partyCreditApproval.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { journalEntryId: null } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.lotMovement.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lotRackPlacement.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

async function lot(party: string, quantity: number, token = operatorToken, extra: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/lots', token, {
    owner_party_id: party,
    commodity_id: POTATO_ID,
    rate_plan_id: RATE_PLAN_SEASONAL,
    chamber_id: CHAMBER_A,
    quantity_bags: quantity,
    accepted_weight_kg: quantity * 20,
    inbound_date: '2026-04-10',
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return data<{ id: string }>(res).id;
}

/** Book bags of a lot onto a truck, and weigh them unless told not to. */
async function onTruck(lotId: string, plate: string, quantity: number, opts: { weigh?: boolean; type?: 'FULL' | 'PARTIAL'; date?: string } = {}) {
  const res = await call('POST', '/v1/outbound-events', operatorToken, {
    lot_id: lotId,
    withdrawal_type: opts.type ?? 'FULL',
    quantity_withdrawn_bags: quantity,
    outbound_date: opts.date ?? businessDate(),
    vehicle_number: plate,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = data<{ id: string }>(res).id;
  if (opts.weigh !== false) {
    const w = await call('PATCH', `/v1/outbound-events/${id}/weight`, operatorToken, { outbound_weight_kg: quantity * 19.5 });
    expect(w.statusCode, w.body).toBe(200);
  }
  return id;
}

async function arrive(plate: string) {
  const res = await call('POST', '/v1/gate-passes/inward', securityToken, { vehicle_number: plate });
  expect(res.statusCode, res.body).toBe(201);
  return data<{ id: string }>(res).id;
}

const truckPreview = async (passId: string, token = managerToken) => {
  const res = await call('GET', `/v1/dispatch/trucks/${passId}/checkout-preview`, token);
  expect(res.statusCode, res.body).toBe(200);
  return data(res);
};

/** The request a reviewing manager sends: each line at its previewed total, one payment row per group. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requestFrom(preview: any, mode: (g: any) => string = () => 'CASH') {
  return {
    lines: preview.lines.map((l: { outbound_id: string; total_pkr: number }) => ({ outbound_id: l.outbound_id, expected_total_pkr: l.total_pkr })),
    payments: preview.groups.map((g: { billing_party: { id: string }; book_type: string }) => ({
      billing_party_id: g.billing_party.id,
      book_type: g.book_type,
      mode: mode(g),
    })),
  };
}

const checkoutTruck = (passId: string, body: unknown, token = managerToken) =>
  call('POST', `/v1/dispatch/trucks/${passId}/dispatch-and-collect`, token, body);

async function nothingWritten(outboundIds: string[]) {
  for (const id of outboundIds) {
    expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id } })).status).not.toBe('DISPATCHED');
  }
  expect(await prisma.invoice.count({ where: { outboundEventId: { in: outboundIds } } })).toBe(0);
  expect(await prisma.payment.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
  expect(await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(0);
}

const setSolo = async (on: boolean) => {
  const res = await call('PATCH', '/v1/facilities/me', ownerToken, { settings: { dispatch_solo_mode: on } });
  expect(res.statusCode, res.body).toBe(200);
};

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  originalSettings = (await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings;
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  securityToken = (await loginAsRole(app, 'SECURITY')).accessToken;
  for (const [name, phone] of [['Truck-Farmer-A', '03019390201'], ['Truck-Farmer-B', '03019390202']] as const) {
    const res = await call('POST', '/v1/parties', operatorToken, { name: `${name}-${Date.now()}`, party_type: 'FARMER', phone_primary: phone });
    expect(res.statusCode, res.body).toBe(201);
    if (name.endsWith('A')) partyA = data(res).id;
    else partyB = data(res).id;
  }
}, 30_000);

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: originalSettings as never } });
  await withGuardsDisabled(prisma, async () => {
    await prisma.party.deleteMany({ where: { id: { in: [partyA, partyB] } } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

describe('a truck with several lots', () => {
  it('two lots, one party, cash: one checkout dispatches and bills both, one receipt takes the money, and the gate lets the truck go', async () => {
    const pass = await arrive('LHR-8100');
    const l1 = await lot(partyA, 30);
    const l2 = await lot(partyA, 20);
    const o1 = await onTruck(l1, 'LHR-8100', 30);
    const o2 = await onTruck(l2, 'lhr 8100', 20);

    const trucks = data<{ gate_pass_id: string; ready: boolean; lines: { outbound_id: string }[] }[]>(await call('GET', '/v1/dispatch/trucks', operatorToken));
    const truck = trucks.find((t) => t.gate_pass_id === pass)!;
    expect(truck.ready).toBe(true);
    expect(truck.lines.map((l) => l.outbound_id).sort()).toEqual([o1, o2].sort());

    const p = await truckPreview(pass);
    expect(p.lines).toHaveLength(2);
    expect(p.groups).toHaveLength(1);
    expect(p.groups[0].total_pkr).toBeCloseTo(p.lines[0].total_pkr + p.lines[1].total_pkr, 2);
    expect(p.total_pkr).toBeCloseTo(p.groups[0].total_pkr, 2);

    const res = await checkoutTruck(pass, requestFrom(p));
    expect(res.statusCode, res.body).toBe(200);
    const body = data(res);
    expect(body.lines).toHaveLength(2);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].receipt_number).toMatch(/^RCP-/);

    for (const [lotId, oid] of [[l1, o1], [l2, o2]]) {
      expect((await prisma.lot.findUniqueOrThrow({ where: { id: lotId } })).currentBalanceBags).toBe(0);
      const inv = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: oid } });
      expect(inv.status).toBe('FINALIZED');
      expect(inv.journalEntryId).toBeTruthy();
      expect(Number(inv.amountPaidPkr)).toBeCloseTo(Number(inv.totalPkr), 2);
    }
    const pay = await prisma.payment.findFirstOrThrow({ where: { facilityId: TEST_FACILITY_ID }, include: { allocations: true } });
    expect(pay.allocations).toHaveLength(2);
    expect(Number(pay.amountPkr)).toBeCloseTo(p.total_pkr, 2);

    // The gate agrees the truck is ready, and releases it on the guard's count of both lots.
    const active = data<{ id: string; release: { state: string } }[]>(await call('GET', '/v1/gate-passes?active=true', securityToken));
    expect(active.find((g) => g.id === pass)!.release.state).toBe('READY');
    const out = await call('POST', `/v1/gate-passes/${pass}/outward`, securityToken, { declared_quantity: 50 });
    expect(out.statusCode, out.body).toBe(200);
    for (const oid of [o1, o2]) expect((await prisma.outboundEvent.findUniqueOrThrow({ where: { id: oid } })).gatePassId).toBe(pass);
  });

  it('two parties: one payment row each — one pays cash, the other goes on credit — one receipt', async () => {
    const pass = await arrive('LHR-8200');
    const oa = await onTruck(await lot(partyA, 20), 'LHR-8200', 20);
    const ob = await onTruck(await lot(partyB, 25), 'LHR-8200', 25);
    const p = await truckPreview(pass);
    expect(p.groups).toHaveLength(2);

    const res = await checkoutTruck(pass, requestFrom(p, (g) => (g.billing_party.id === partyA ? 'CASH' : 'CREDIT')));
    expect(res.statusCode, res.body).toBe(200);
    expect(data(res).payments.map((x: { billing_party_id: string }) => x.billing_party_id)).toEqual([partyA]);
    const invA = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: oa } });
    const invB = await prisma.invoice.findFirstOrThrow({ where: { outboundEventId: ob } });
    expect(Number(invA.amountPaidPkr)).toBeCloseTo(Number(invA.totalPkr), 2);
    expect([invB.status, Number(invB.amountPaidPkr)]).toEqual(['FINALIZED', 0]);
  });

  it('two books: a KATCHI cash receipt is the owner\'s to take — a manager\'s checkout rolls the whole truck back; the owner\'s posts a receipt per book', async () => {
    const pass = await arrive('LHR-8300');
    const op = await onTruck(await lot(partyA, 20), 'LHR-8300', 20);
    const ok = await onTruck(await lot(partyA, 15, ownerToken, { book_type: 'KATCHI' }), 'LHR-8300', 15);
    const p = await truckPreview(pass, ownerToken);
    expect(p.groups.map((g: { book_type: string }) => g.book_type).sort()).toEqual(['KATCHI', 'PACCI']);

    const byManager = await checkoutTruck(pass, requestFrom(p));
    expect(byManager.statusCode).toBe(403);
    await nothingWritten([op, ok]);

    const byOwner = await checkoutTruck(pass, requestFrom(p), ownerToken);
    expect(byOwner.statusCode, byOwner.body).toBe(200);
    const books = (await prisma.payment.findMany({ where: { facilityId: TEST_FACILITY_ID } })).map((x) => x.bookType).sort();
    expect(books).toEqual(['KATCHI', 'PACCI']);
  });
});

describe('a truck that is not ready, or changed since it was reviewed', () => {
  it('a booked line not yet weighed: the truck is not ready, and nothing is written', async () => {
    const pass = await arrive('LHR-8400');
    const weighed = await onTruck(await lot(partyA, 20), 'LHR-8400', 20);
    const booked = await onTruck(await lot(partyA, 10), 'LHR-8400', 10, { weigh: false });
    const trucks = data<{ gate_pass_id: string; ready: boolean }[]>(await call('GET', '/v1/dispatch/trucks', managerToken));
    expect(trucks.find((t) => t.gate_pass_id === pass)!.ready).toBe(false);
    const p = await truckPreview(pass);
    expect(p.not_ready).toHaveLength(1);
    const res = await checkoutTruck(pass, requestFrom(p));
    expect([res.statusCode, code(res)]).toEqual([409, 'TRUCK_NOT_READY']);
    await nothingWritten([weighed, booked]);
  });

  it('a line left out, or one not on the truck, is refused as a changed load', async () => {
    const pass = await arrive('LHR-8500');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-8500', 20);
    const o2 = await onTruck(await lot(partyA, 10), 'LHR-8500', 10);
    const elsewhere = await onTruck(await lot(partyA, 5), 'LHR-8599', 5);
    const p = await truckPreview(pass);
    const req = requestFrom(p);

    const missing = await checkoutTruck(pass, { ...req, lines: req.lines.slice(0, 1) });
    expect([missing.statusCode, code(missing)]).toEqual([409, 'TRUCK_LOAD_CHANGED']);
    const extra = await checkoutTruck(pass, { ...req, lines: [...req.lines, { outbound_id: elsewhere, expected_total_pkr: 1 }] });
    expect([extra.statusCode, code(extra)]).toEqual([409, 'TRUCK_LOAD_CHANGED']);
    await nothingWritten([o1, o2, elsewhere]);
  });

  it('one line\'s total changed: refused naming its dispatch note, and the other line is not dispatched either', async () => {
    const pass = await arrive('LHR-8600');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-8600', 20);
    const o2 = await onTruck(await lot(partyA, 10), 'LHR-8600', 10);
    const p = await truckPreview(pass);
    const req = requestFrom(p);
    const last = req.lines.length - 1;
    req.lines[last] = { ...req.lines[last], expected_total_pkr: req.lines[last].expected_total_pkr - 50 };
    const res = await checkoutTruck(pass, req);
    expect([res.statusCode, code(res)]).toEqual([409, 'DISPATCH_TOTAL_CHANGED']);
    expect(JSON.parse(res.body).error.message).toMatch(/^DN-/);
    await nothingWritten([o1, o2]);
  });

  it('more than 20 lines, or payment rows that do not match the parties on the truck, are refused before anything is read', async () => {
    const pass = await arrive('LHR-8700');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-8700', 20);
    const lines = Array.from({ length: 21 }, () => ({ outbound_id: crypto.randomUUID(), expected_total_pkr: 1 }));
    const tooMany = await checkoutTruck(pass, { lines, payments: [{ billing_party_id: partyA, book_type: 'PACCI', mode: 'CASH' }] });
    expect([tooMany.statusCode, code(tooMany)]).toEqual([422, 'TRUCK_TOO_MANY_LINES']);

    const p = await truckPreview(pass);
    const req = requestFrom(p);
    const wrongParty = await checkoutTruck(pass, { ...req, payments: [{ billing_party_id: partyB, book_type: 'PACCI', mode: 'CASH' }] });
    expect([wrongParty.statusCode, code(wrongParty)]).toEqual([422, 'TRUCK_PAYMENTS_MISMATCH']);
    const twice = await checkoutTruck(pass, { ...req, payments: [...req.payments, ...req.payments] });
    expect([twice.statusCode, code(twice)]).toEqual([422, 'TRUCK_PAYMENTS_MISMATCH']);
    await nothingWritten([o1]);
  });
});

describe('races', () => {
  it('the same truck checked out twice at once: one takes it, the other is refused — one set of bills, one receipt', async () => {
    const pass = await arrive('LHR-8800');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-8800', 20);
    const o2 = await onTruck(await lot(partyA, 10), 'LHR-8800', 10);
    const req = requestFrom(await truckPreview(pass));
    const [a, b] = await Promise.all([checkoutTruck(pass, req), checkoutTruck(pass, req)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.invoice.count({ where: { outboundEventId: { in: [o1, o2] } } })).toBe(2);
    expect(await prisma.payment.count({ where: { facilityId: TEST_FACILITY_ID } })).toBe(1);
  }, 45_000);

  it('two trucks each taking part of the same two lots, at once: both go, and each lot loses exactly what both took', async () => {
    const l1 = await lot(partyA, 100);
    const l2 = await lot(partyA, 100);
    const passX = await arrive('LHR-8901');
    const passY = await arrive('LHR-8902');
    for (const plate of ['LHR-8901', 'LHR-8902']) {
      await onTruck(l1, plate, 30, { type: 'PARTIAL' });
      await onTruck(l2, plate, 25, { type: 'PARTIAL' });
    }
    const [reqX, reqY] = [requestFrom(await truckPreview(passX)), requestFrom(await truckPreview(passY))];
    const [x, y] = await Promise.all([checkoutTruck(passX, reqX), checkoutTruck(passY, reqY)]);
    expect([x.statusCode, y.statusCode], `${x.body} / ${y.body}`).toEqual([200, 200]);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: l1 } })).currentBalanceBags).toBe(40);
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: l2 } })).currentBalanceBags).toBe(50);
  }, 45_000);
});

describe('the munshi alone (solo switch on)', () => {
  afterEach(() => setSolo(false));

  it('a clean truck — PACCI, dated today, cash in full — the munshi checks out alone', async () => {
    await setSolo(true);
    const pass = await arrive('LHR-9100');
    await onTruck(await lot(partyA, 20), 'LHR-9100', 20);
    await onTruck(await lot(partyA, 10), 'LHR-9100', 10);
    const p = await truckPreview(pass, operatorToken);
    expect(p.solo.allowed).toBe(true);
    const res = await checkoutTruck(pass, requestFrom(p), operatorToken);
    expect(res.statusCode, res.body).toBe(200);
  });

  it('one backdated line sends the whole truck to a manager', async () => {
    await setSolo(true);
    const pass = await arrive('LHR-9200');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-9200', 20);
    const o2 = await onTruck(await lot(partyA, 10), 'LHR-9200', 10, { date: addDays(businessDate(), -1) });
    const p = await truckPreview(pass, operatorToken);
    expect(p.solo.allowed).toBe(false);
    const res = await checkoutTruck(pass, requestFrom(p), operatorToken);
    expect([res.statusCode, code(res)]).toEqual([403, 'DISPATCH_NEEDS_MANAGER']);
    await nothingWritten([o1, o2]);
  });

  it('on credit: a ceiling that holds one of the party\'s bills but not both — offered no credit, refused, nothing written', async () => {
    await setSolo(true);
    const pass = await arrive('LHR-9300');
    const o1 = await onTruck(await lot(partyA, 20), 'LHR-9300', 20);
    const o2 = await onTruck(await lot(partyA, 20), 'LHR-9300', 20);
    const before = await truckPreview(pass);
    const one = Math.max(...before.lines.map((l: { total_pkr: number }) => l.total_pkr));
    const approve = await call('POST', `/v1/parties/${partyA}/credit-approval`, managerToken, { max_outstanding_pkr: Math.ceil(one) + 1 });
    expect(approve.statusCode, approve.body).toBe(201);

    const p = await truckPreview(pass, operatorToken);
    expect(p.groups[0].credit_available).toBe(false);
    const res = await checkoutTruck(pass, requestFrom(p, () => 'CREDIT'), operatorToken);
    expect([res.statusCode, code(res)]).toEqual([403, 'DISPATCH_NEEDS_MANAGER']);
    await nothingWritten([o1, o2]);
  });
});

describe('the load slip and the gate receipt', () => {
  /** A checked-out truck: party A's lot paid in cash, party B's on credit by the manager. */
  async function checkedOut(plate: string) {
    const pass = await arrive(plate);
    const oa = await onTruck(await lot(partyA, 20, operatorToken, { marka: 'AH' }), plate, 20);
    const ob = await onTruck(await lot(partyB, 15, operatorToken, { marka: 'GH' }), plate, 15);
    const p = await truckPreview(pass);
    const res = await checkoutTruck(pass, requestFrom(p, (g) => (g.billing_party.id === partyA ? 'CASH' : 'CREDIT')));
    expect(res.statusCode, res.body).toBe(200);
    return { pass, oa, ob, receipt: data(res).payments[0].receipt_number as string };
  }
  const slipHtml = async (pass: string, token = managerToken) => {
    const res = await call('GET', `/v1/dispatch/trucks/${pass}/load-slip?format=html`, token);
    expect(res.statusCode, res.body).toBe(200);
    return res.body;
  };

  it('lists every line, bill and receipt on the truck, and who let the rest go on credit — before and after it leaves', async () => {
    const t = await checkedOut('LHR-9600');
    const invoices = await prisma.invoice.findMany({ where: { outboundEventId: { in: [t.oa, t.ob] } } });
    const dns = (await prisma.outboundEvent.findMany({ where: { id: { in: [t.oa, t.ob] } } })).map((o) => o.dispatchNoteNumber!);
    const manager = await prisma.user.findFirstOrThrow({ where: { email: 'manager@coldchain.pk' } });

    const html = await slipHtml(t.pass);
    for (const s of [...dns, ...invoices.map((i) => i.invoiceNumber!), t.receipt, 'AH', 'GH', manager.name]) expect(html).toContain(s);

    // Party B is on credit: the truck leaves on a manager's authorization at the gate.
    const released = await call('POST', `/v1/gate-passes/${t.pass}/outward`, managerToken, { declared_quantity: 35, credit_authorization: true });
    expect(released.statusCode, released.body).toBe(200);
    const after = await slipHtml(t.pass);
    for (const s of [...dns, t.receipt]) expect(after).toContain(s);

    const pdf = await call('GET', `/v1/dispatch/trucks/${t.pass}/load-slip`, managerToken);
    expect([pdf.statusCode, pdf.headers['content-type']]).toEqual([200, 'application/pdf']);
  });

  it('is never the guard\'s', async () => {
    const t = await checkedOut('LHR-9700');
    expect((await call('GET', `/v1/dispatch/trucks/${t.pass}/load-slip?format=html`, securityToken)).statusCode).toBe(403);
  });

  it('the gate receipt names every withdrawal on the truck — dispatch note, marka, owner — and no count', async () => {
    const t = await checkedOut('LHR-9800');
    const released = await call('POST', `/v1/gate-passes/${t.pass}/outward`, managerToken, { declared_quantity: 35, credit_authorization: true });
    expect(released.statusCode, released.body).toBe(200);
    const guard = data(await call('GET', `/v1/gate-passes/${t.pass}/receipt?format=json`, securityToken));
    expect(guard.withdrawals).toHaveLength(2);
    expect(guard.withdrawals.map((w: { marka: string }) => w.marka).sort()).toEqual(['AH', 'GH']);
    for (const w of guard.withdrawals) {
      expect(Object.keys(w).sort()).toEqual(['dispatch_note_number', 'marka', 'owner_party_name']);
      expect(w.dispatch_note_number).toMatch(/^DN-/);
    }
    expect(guard.authorized_quantity).toBeNull();
  });
});

describe('the truck routes', () => {
  it('one truck per plate: an older pass for the same plate is not a second truck', async () => {
    await arrive('LHR-9400');
    const newer = await arrive('LHR 9400');
    await onTruck(await lot(partyA, 10), 'LHR-9400', 10);
    const trucks = data<{ gate_pass_id: string; vehicle_number: string }[]>(await call('GET', '/v1/dispatch/trucks', managerToken));
    const mine = trucks.filter((t) => t.vehicle_number.replace(/[^A-Z0-9]/gi, '').toUpperCase() === 'LHR9400');
    expect(mine.map((t) => t.gate_pass_id)).toEqual([newer]);
  });

  it('are not for the guard', async () => {
    const pass = await arrive('LHR-9500');
    expect((await call('GET', '/v1/dispatch/trucks', securityToken)).statusCode).toBe(403);
    expect((await call('GET', `/v1/dispatch/trucks/${pass}/checkout-preview`, securityToken)).statusCode).toBe(403);
    const valid = { lines: [{ outbound_id: pass, expected_total_pkr: 1 }], payments: [{ billing_party_id: partyA, book_type: 'PACCI', mode: 'CASH' }] };
    expect((await checkoutTruck(pass, valid, securityToken)).statusCode).toBe(403);
  });
});
