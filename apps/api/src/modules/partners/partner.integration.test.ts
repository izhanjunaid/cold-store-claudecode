/**
 * A partner is a record now, not something the statements infer from an
 * account's normal balance.
 *
 * The defect this exists to prevent is specific and was live: an owner with a
 * drawings account, no capital account, and nothing able to notice — because
 * nothing knew a partner needed both, or which two accounts were one person's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let accountantToken: string;

// Everything this file creates is named with the prefix, so cleanup can find it
// without guessing and without touching accounts other suites rely on.
const MARK = 'PTEST';

async function cleanup() {
  const partners = await prisma.partner.findMany({
    where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
    select: { id: true, capitalAccountCode: true, drawingsAccountCode: true },
  });
  await prisma.partnerProfitShare.deleteMany({
    where: { partnerId: { in: partners.map((p) => p.id) } },
  });
  await prisma.partner.deleteMany({ where: { id: { in: partners.map((p) => p.id) } } });
  await prisma.chartOfAccounts.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, accountName: { startsWith: MARK } },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

const createPartner = (token: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/v1/partners',
    headers: authHeaders(token),
    payload,
  });

const accountsFor = (name: string) =>
  prisma.chartOfAccounts.findMany({
    where: { facilityId: TEST_FACILITY_ID, accountName: { startsWith: name } },
    orderBy: { accountCode: 'asc' },
  });

describe('adding an owner opens both of their accounts, or neither', () => {
  it('creates exactly two accounts, correctly coded, named, parented and sided', async () => {
    const name = `${MARK} Ayesha`;
    const res = await createPartner(ownerToken, { name, admitted_on: '2026-01-01' });
    expect(res.statusCode).toBe(201);

    const accounts = await accountsFor(name);
    expect(accounts).toHaveLength(2);

    const capital = accounts.find((a) => a.normalBalance === 'CREDIT')!;
    const drawings = accounts.find((a) => a.normalBalance === 'DEBIT')!;

    expect(capital.accountName).toBe(`${name} — Capital`);
    expect(capital.parentAccountCode).toBe('3100');
    expect(capital.accountClass).toBe('EQUITY');
    expect(capital.accountType).toBe('DETAIL');

    expect(drawings.accountName).toBe(`${name} — Drawings`);
    expect(drawings.parentAccountCode).toBe('3200');
    // Contra-equity. This is what the statements read to know it is drawings,
    // so it is the field that must not be wrong.
    expect(drawings.normalBalance).toBe('DEBIT');

    // Codes come from the same suggester the Add Account form uses, so they land
    // inside their header's block rather than anywhere free.
    expect(Number(capital.accountCode)).toBeGreaterThanOrEqual(3100);
    expect(Number(capital.accountCode)).toBeLessThan(3200);
    expect(Number(drawings.accountCode)).toBeGreaterThanOrEqual(3200);
    expect(Number(drawings.accountCode)).toBeLessThan(3300);
  });

  /**
   * The invariant the whole record exists for. Both accounts and the partner row
   * are created in one transaction, so a failure at the last step must leave no
   * accounts behind — otherwise "half a partner" is reachable again, which is
   * exactly the state that went unnoticed in a live chart.
   */
  it('leaves no orphan accounts when the partner row itself fails', async () => {
    const name = `${MARK} Bilal`;
    expect((await createPartner(ownerToken, { name, admitted_on: '2026-01-01' })).statusCode).toBe(201);
    const before = (await accountsFor(name)).map((a) => a.accountCode);
    expect(before).toHaveLength(2);

    // Same name: the unique index rejects it *after* both accounts would have
    // been created, which is precisely the ordering that would strand them.
    const dup = await createPartner(ownerToken, { name, admitted_on: '2026-02-01' });
    expect(dup.statusCode).toBeGreaterThanOrEqual(400);

    const after = (await accountsFor(name)).map((a) => a.accountCode);
    expect(after).toEqual(before);
  });
});

describe('adopting accounts an owner already has', () => {
  it('takes over existing accounts instead of opening new ones', async () => {
    // A facility that predates the partner record cannot delete and recreate its
    // accounts once anything has posted, so adoption is the only route open.
    const capital = await prisma.chartOfAccounts.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '3191',
        accountName: `${MARK} Existing — Capital`,
        accountClass: 'EQUITY',
        accountType: 'DETAIL',
        parentAccountCode: '3100',
        normalBalance: 'CREDIT',
      },
    });
    const drawings = await prisma.chartOfAccounts.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '3291',
        accountName: `${MARK} Existing — Drawings`,
        accountClass: 'EQUITY',
        accountType: 'DETAIL',
        parentAccountCode: '3200',
        normalBalance: 'DEBIT',
      },
    });

    const res = await createPartner(ownerToken, {
      name: `${MARK} Existing`,
      admitted_on: '2026-01-01',
      capital_account_code: capital.accountCode,
      drawings_account_code: drawings.accountCode,
    });
    expect(res.statusCode).toBe(201);

    // Adopted, not duplicated: still exactly the two accounts that already existed.
    expect(await accountsFor(`${MARK} Existing`)).toHaveLength(2);
  });

  it('refuses an account that already belongs to someone, naming them', async () => {
    const taken = await prisma.partner.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, name: `${MARK} Existing` },
    });
    const res = await createPartner(ownerToken, {
      name: `${MARK} Thief`,
      admitted_on: '2026-01-01',
      capital_account_code: taken.capitalAccountCode,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toContain(`${MARK} Existing`);
  });

  it('refuses an account on the wrong side — the normal balance IS the role', async () => {
    const drawings = await prisma.chartOfAccounts.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, accountName: `${MARK} Existing — Drawings` },
    });
    const res = await createPartner(ownerToken, {
      name: `${MARK} Wrongside`,
      admitted_on: '2026-01-01',
      // A DEBIT-normal account offered as capital. Every statement would read it
      // as drawings, and guard_chart_of_accounts locks the side once anything
      // posts — so this cannot be corrected later.
      capital_account_code: drawings.accountCode,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.message).toMatch(/CREDIT-normal/);
  });
});

describe('the profit-sharing ratio', () => {
  it('is owner-gated — an accountant may read the owners but not set the split', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/v1/partners', headers: authHeaders(accountantToken) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await createPartner(accountantToken, { name: `${MARK} Nope`, admitted_on: '2026-01-01' }))
        .statusCode,
    ).toBe(403);
  });

  it('stores a window and reports each partner’s percentage of it', async () => {
    const partners = await prisma.partner.findMany({
      where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
      orderBy: { name: 'asc' },
      take: 2,
    });
    expect(partners.length).toBe(2);

    const put = await app.inject({
      method: 'PUT',
      url: '/v1/partners/profit-shares',
      headers: authHeaders(ownerToken),
      payload: {
        effective_from: '2026-01-01',
        // Weights, not percentages — 3:1 is a ratio nobody has to make add to 100.
        shares: [
          { partner_id: partners[0]!.id, weight: 3 },
          { partner_id: partners[1]!.id, weight: 1 },
        ],
      },
    });
    expect(put.statusCode).toBe(200);

    const windows = JSON.parse(
      (await app.inject({ method: 'GET', url: '/v1/partners/profit-shares', headers: authHeaders(ownerToken) }))
        .body,
    ).data;
    const window = windows.find((w: { effective_from: string }) => w.effective_from === '2026-01-01');
    expect(window.shares).toHaveLength(2);
    expect(window.shares.map((s: { share_pct: number }) => s.share_pct).sort()).toEqual([25, 75]);
  });

  it('replaces a window rather than merging into it', async () => {
    // A ratio is a set read together; leaving one partner's old row beside two
    // new ones would produce a split nobody chose.
    const partner = await prisma.partner.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
    });
    await app.inject({
      method: 'PUT',
      url: '/v1/partners/profit-shares',
      headers: authHeaders(ownerToken),
      payload: { effective_from: '2026-01-01', shares: [{ partner_id: partner.id, weight: 1 }] },
    });

    const rows = await prisma.partnerProfitShare.findMany({
      where: { facilityId: TEST_FACILITY_ID, effectiveFrom: new Date('2026-01-01') },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partnerId).toBe(partner.id);
  });

  it('rejects the same partner twice in one ratio', async () => {
    const partner = await prisma.partner.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
    });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/partners/profit-shares',
      headers: authHeaders(ownerToken),
      payload: {
        effective_from: '2026-06-01',
        shares: [
          { partner_id: partner.id, weight: 1 },
          { partner_id: partner.id, weight: 2 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
