/**
 * GET /v1/system/version — what this box is running, and whether its last
 * update finished.
 *
 * The assertion that earns its keep is the last one. A version string is easy
 * to serve and impossible to get wrong; the claim worth testing is that the
 * migrations shipped in the image are compared against the ones the database
 * has actually applied. That comparison exists because a client box failed to
 * migrate on every update for months while the app carried on serving the old
 * schema, and nothing on screen said so.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders } from '../../../test/helpers';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let ownerToken: string;
let operatorToken: string;

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
});

afterAll(async () => {
  await closeTestApp();
});

describe('GET /v1/system/version', () => {
  it('reports the build, and says "dev" when nothing was stamped in', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/system/version',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    // The test suite runs an unstamped build, so 'dev' is the correct answer —
    // and a released image must not silently fall back to it.
    expect(d.version).toBe('dev');
    expect(d.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('counts the migrations this image ships and the ones the database applied', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/system/version',
      headers: authHeaders(ownerToken),
    });
    const db = res.json().data.database;
    expect(db.migrations_in_image).toBeGreaterThan(0);
    expect(db.migrations_applied).toBeGreaterThan(0);
    expect(db.latest_migration).toBeTruthy();
  });

  it('reports nothing pending against a database the suite just migrated', async () => {
    // This is the check the panel turns into "the database carries every change
    // in this version". If it ever reports pending here, either the suite ran
    // against a half-migrated database or the comparison is broken — both are
    // worth failing on.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/system/version',
      headers: authHeaders(ownerToken),
    });
    const db = res.json().data.database;
    expect(db.pending_migrations).toEqual([]);
    // Deliberately NOT an equality check. A database can hold MORE applied
    // migrations than the image ships — a box provisioned before the phase-13
    // rebaseline carries legacy names no current image knows about, and the
    // dev database does exactly that (27 applied against 25 shipped). What
    // matters is that nothing this image ships is missing.
    expect(db.migrations_applied).toBeGreaterThanOrEqual(db.migrations_in_image);
  });

  it('is gated on settings.manage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/system/version',
      headers: authHeaders(operatorToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('needs a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/system/version' });
    expect(res.statusCode).toBe(401);
  });
});
