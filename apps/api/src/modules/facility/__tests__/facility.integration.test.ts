import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
  sentMails,
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

describe('Phase 12 facility settings', () => {
  it('GET returns Phase 12 defaults for legacy settings rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const s = JSON.parse(res.body).data.settings;
    expect(s.chamber_capacity_warning_pct).toBe(90);
    expect(s.backdating_max_days).toBeNull();
    expect(s.gst_default_rate).toBe(18);
    expect(s.late_payment_surcharge).toEqual({
      enabled: false,
      pct_per_month: 2,
      grace_days: 30,
    });
  });

  it('PATCH round-trips Phase 12 settings', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: {
        settings: {
          chamber_capacity_warning_pct: 75,
          backdating_max_days: 14,
          gst_default_rate: 17.5,
          late_payment_surcharge: { enabled: true, pct_per_month: 1.5, grace_days: 45 },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const s = JSON.parse(res.body).data.settings;
    expect(s.chamber_capacity_warning_pct).toBe(75);
    expect(s.backdating_max_days).toBe(14);
    expect(s.gst_default_rate).toBe(17.5);
    expect(s.late_payment_surcharge).toEqual({
      enabled: true,
      pct_per_month: 1.5,
      grace_days: 45,
    });
    // untouched keys preserved
    expect(typeof s.weight_dispute_threshold_kg).toBe('number');
  });

  it('PATCH can reset backdating_max_days to null (unlimited)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { backdating_max_days: null } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.settings.backdating_max_days).toBeNull();
  });

  it('PATCH rejects out-of-range values (400)', async () => {
    const tooHighPct = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { chamber_capacity_warning_pct: 150 } },
    });
    expect(tooHighPct.statusCode).toBe(400);

    const negativeGrace = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: {
        settings: {
          late_payment_surcharge: { enabled: true, pct_per_month: 2, grace_days: -1 },
        },
      },
    });
    expect(negativeGrace.statusCode).toBe(400);
  });
});

describe('Phase 15 email settings', () => {
  const emailPayload = {
    enabled: true,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_secure: false,
    smtp_user: 'owner@gmail.com',
    from_name: 'Test Cold Store',
    admin_email: 'owner@gmail.com',
  };

  it('GET returns email defaults with smtp_password_set=false for legacy rows', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const email = JSON.parse(res.body).data.settings.email;
    expect(email.enabled).toBe(false);
    expect(email.smtp_host).toBe('smtp.gmail.com');
    expect(email.smtp_password_set).toBe(false);
    expect(email.smtp_password).toBeUndefined();
    expect(email.smtp_password_enc).toBeUndefined();
  });

  it('PATCH stores the SMTP password encrypted and never returns it', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { email: { ...emailPayload, smtp_password: 'app-password-abc' } } },
    });
    expect(res.statusCode).toBe(200);
    const email = JSON.parse(res.body).data.settings.email;
    expect(email.smtp_password_set).toBe(true);
    expect(email.smtp_password).toBeUndefined();
    expect(email.smtp_password_enc).toBeUndefined();
    expect(email.admin_email).toBe('owner@gmail.com');

    // Stored encrypted, not plaintext
    const row = await prisma.facility.findUnique({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
    const stored = (row!.settings as Record<string, any>)['email'];
    expect(stored.smtp_password).toBeUndefined();
    expect(stored.smtp_password_enc).toBeTruthy();
    expect(stored.smtp_password_enc).not.toContain('app-password-abc');
  });

  it('PATCH without smtp_password keeps the existing password', async () => {
    const before = await prisma.facility.findUnique({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
    const encBefore = (before!.settings as Record<string, any>)['email'].smtp_password_enc;

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { email: { ...emailPayload, from_name: 'Renamed Store' } } },
    });
    expect(res.statusCode).toBe(200);
    const email = JSON.parse(res.body).data.settings.email;
    expect(email.from_name).toBe('Renamed Store');
    expect(email.smtp_password_set).toBe(true);

    const after = await prisma.facility.findUnique({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
    expect((after!.settings as Record<string, any>)['email'].smtp_password_enc).toBe(encBefore);
  });

  it('POST test-email sends through the configured transport', async () => {
    sentMails.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/facilities/me/test-email',
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sent).toBe(true);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe('owner@gmail.com');
    expect(sentMails[0]!.config.password).toBe('app-password-abc');
    expect(sentMails[0]!.subject).toContain('test email');
  });

  it('POST test-email respects an explicit recipient', async () => {
    sentMails.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/facilities/me/test-email',
      headers: authHeaders(ownerToken),
      payload: { to: 'other@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sent).toBe(true);
    expect(sentMails[0]!.to).toBe('other@example.com');
  });

  it('POST test-email reports not-configured when email is disabled', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { email: { ...emailPayload, enabled: false } } },
    });
    sentMails.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/facilities/me/test-email',
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.sent).toBe(false);
    expect(data.error).toMatch(/not configured/i);
    expect(sentMails).toHaveLength(0);
  });

  it('POST test-email — MANAGER is denied (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/facilities/me/test-email',
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH rejects an invalid admin_email (400)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { email: { ...emailPayload, admin_email: 'not-an-email' } } },
    });
    expect(res.statusCode).toBe(400);
  });
});
