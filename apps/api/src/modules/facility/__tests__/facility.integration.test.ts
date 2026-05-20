import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let originalSettings: unknown;
let originalGstNumber: string | null;

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  const manager = await loginAsRole(app, 'MANAGER');
  ownerToken = owner.accessToken;
  managerToken = manager.accessToken;

  const facility = await prisma.facility.findUnique({
    where: { id: TEST_FACILITY_ID },
    select: { settings: true, gstNumber: true },
  });
  originalSettings = facility?.settings ?? {};
  originalGstNumber = facility?.gstNumber ?? null;

  // Reset to canonical Phase 11 settings shape (the seed predates Phase 11
  // and may carry legacy keys like `number_format: 'international'`).
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: {
      settings: {
        weight_dispute_threshold_kg: 5,
        storage_alert_thresholds: {},
        gst_registered: false,
        number_format: 'en-PK',
      } as never,
    },
  });
});

afterAll(async () => {
  // Restore facility row to pristine state
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: {
      settings: (originalSettings ?? {}) as never,
      gstNumber: originalGstNumber,
    },
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Facility settings', () => {
  it('GET /v1/facilities/me returns facility with settings (any authenticated user)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/facilities/me',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(TEST_FACILITY_ID);
    expect(body.data.settings).toBeDefined();
    expect(typeof body.data.settings.weight_dispute_threshold_kg).toBe('number');
    expect(body.data.settings.number_format).toMatch(/^(en-PK|en-IN)$/);
  });

  it('PATCH /v1/facilities/me — OWNER can update settings and merges with existing', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: {
        gst_number: 'GST-PHASE11-TEST',
        settings: {
          weight_dispute_threshold_kg: 12,
          gst_registered: true,
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.gst_number).toBe('GST-PHASE11-TEST');
    expect(body.data.settings.weight_dispute_threshold_kg).toBe(12);
    expect(body.data.settings.gst_registered).toBe(true);
    // Non-patched fields keep their defaults / prior values
    expect(body.data.settings.number_format).toMatch(/^(en-PK|en-IN)$/);
  });

  it('PATCH /v1/facilities/me — MANAGER is denied (403)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(managerToken),
      payload: { settings: { weight_dispute_threshold_kg: 99 } },
    });
    expect(res.statusCode).toBe(403);
  });
});
