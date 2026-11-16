import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { addDays, businessDate } from '@coldchain/shared';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { applyDueSettings, settingsOn } from '../settings-store';
import { billingFixture } from '../../invoice/__tests__/billing-fixture';

/**
 * Dated settings (docs/32 section 2.2): a business setting is saved with the day it
 * takes effect, its history is kept, and a paper is priced with what was in force on
 * the paper's own date.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let owner: string;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let original: unknown;
const today = businessDate();

async function patch(body: Record<string, unknown>) {
  const res = await app.inject({ method: 'PATCH', url: '/v1/facilities/me', headers: authHeaders(owner), payload: body });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function get(url: string) {
  const res = await app.inject({ method: 'GET', url, headers: authHeaders(owner) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeAll(async () => {
  app = await getTestApp();
  owner = (await loginAsRole(app, 'OWNER')).accessToken;
  fx = await billingFixture(app);
  original = (await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings;
  await prisma.facilitySettingVersion.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await prisma.facilitySettingVersion.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: original as never } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('dated settings', () => {
  it('a change dated today applies at once, keeps the value it replaced, and is audit-logged', async () => {
    const before = (await get('/v1/facilities/me')).body.data.settings.chamber_capacity_warning_pct;
    const r = await patch({ settings: { chamber_capacity_warning_pct: 77 }, note: 'tighter warning' });
    expect(r.status).toBe(200);
    expect(r.body.data.settings.chamber_capacity_warning_pct).toBe(77);
    expect(r.body.data.pending_settings).toEqual([]);

    const history = (await get('/v1/facilities/me/settings/history?key=chamber_capacity_warning_pct')).body.data;
    expect(history.map((h: { value: number }) => h.value)).toEqual([77, before]);
    expect(history[0]).toMatchObject({ effective_from: today, note: 'tighter warning', in_force: true });
    expect(history[0].saved_by_name).toBeTruthy();
    expect(history[1].is_baseline).toBe(true);

    const audit = await prisma.auditLog.count({ where: { tableName: 'facility_setting_versions', facilityId: TEST_FACILITY_ID } });
    expect(audit).toBeGreaterThanOrEqual(2);
  });

  it('saving the same values again writes no version', async () => {
    const count = () => prisma.facilitySettingVersion.count({ where: { facilityId: TEST_FACILITY_ID } });
    const n = await count();
    const current = (await get('/v1/facilities/me')).body.data.settings;
    const { email: _email, ...rest } = current;
    expect((await patch({ settings: rest })).status).toBe(200);
    expect(await count()).toBe(n);
  });

  it('a change dated ahead waits: not in force today, listed as coming, in force on its day', async () => {
    const from = addDays(today, 10);
    const r = await patch({ settings: { chamber_capacity_warning_pct: 55 }, effective_from: from });
    expect(r.status).toBe(200);
    expect(r.body.data.settings.chamber_capacity_warning_pct).toBe(77);
    expect(r.body.data.pending_settings).toMatchObject([{ key: 'chamber_capacity_warning_pct', value: 55, effective_from: from, in_force: false }]);

    expect((await settingsOn(prisma, TEST_FACILITY_ID)).chamber_capacity_warning_pct).toBe(77);
    expect((await settingsOn(prisma, TEST_FACILITY_ID, addDays(from, -1))).chamber_capacity_warning_pct).toBe(77);
    expect((await settingsOn(prisma, TEST_FACILITY_ID, from)).chamber_capacity_warning_pct).toBe(55);
  });

  it('a past date is refused', async () => {
    const r = await patch({ settings: { chamber_capacity_warning_pct: 60 }, effective_from: addDays(today, -1) });
    expect(r.status).toBe(400);
  });

  it('a change whose day has come is applied to the stored settings', async () => {
    // Stand in for the calendar: move the waiting change's day to today.
    await prisma.facilitySettingVersion.updateMany({
      where: { facilityId: TEST_FACILITY_ID, appliedAt: null },
      data: { effectiveFrom: new Date(`${today}T00:00:00.000Z`) },
    });
    expect((await settingsOn(prisma, TEST_FACILITY_ID)).chamber_capacity_warning_pct).toBe(55); // right even before it is applied
    expect(await applyDueSettings(prisma, TEST_FACILITY_ID)).toBe(1);
    const f = (await get('/v1/facilities/me')).body.data;
    expect(f.settings.chamber_capacity_warning_pct).toBe(55);
    expect(f.pending_settings).toEqual([]);
  });

  it('a bill is priced with the tax in force on its own date, not on the day it is made', async () => {
    // Sales tax switched on from today. A bill for a withdrawal dated last week is made now.
    expect((await patch({ settings: { gst_registered: true, gst_default_rate: 8 } })).status).toBe(200);
    const partyId = await fx.party('Dated Tax Party');
    const lastWeek = addDays(today, -7);
    const old = await fx.invoice(partyId, { inbound: addDays(today, -40), outbound: lastWeek });
    expect(Number(old.invoice.gst_rate)).toBe(0);
    const now = await fx.invoice(partyId, { inbound: addDays(today, -40), outbound: today });
    expect(Number(now.invoice.gst_rate)).toBe(8);

    // And on a past day the settings read back as they were.
    expect((await settingsOn(prisma, TEST_FACILITY_ID, lastWeek)).gst_registered).toBe(false);
  });
});
