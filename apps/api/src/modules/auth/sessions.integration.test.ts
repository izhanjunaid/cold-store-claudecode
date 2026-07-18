import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;

interface SessionRow {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
}

const listSessions = (token: string) =>
  app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: authHeaders(token) });

const doRefresh = (refreshToken: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { refresh_token: refreshToken },
  });

const sessionsOf = (body: string): SessionRow[] => JSON.parse(body).data.sessions;

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Sessions API', () => {
  it('a login shows up as a session flagged as the current device', async () => {
    const a = await loginAsRole(app, 'OPERATOR');
    const res = await listSessions(a.accessToken);
    expect(res.statusCode).toBe(200);
    const list = sessionsOf(res.body);
    // Exactly one row matches the access token's sid, regardless of how many
    // other sessions this shared test user has.
    expect(list.filter((s) => s.current)).toHaveLength(1);
    // inject stamps a user-agent + remote address, so metadata is captured.
    const current = list.find((s) => s.current)!;
    expect(current.ip).toBeTruthy();
  });

  it('DELETE /v1/auth/sessions/:id signs out that device (its refresh token dies)', async () => {
    const a = await loginAsRole(app, 'OPERATOR');
    const b = await loginAsRole(app, 'OPERATOR'); // same user, second device

    // Discover b's session id from b's own list (its current row).
    const bSid = sessionsOf((await listSessions(b.accessToken)).body).find((s) => s.current)!.id;

    // a revokes b's session (same user → allowed).
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${bSid}`,
      headers: authHeaders(a.accessToken),
    });
    expect(del.statusCode).toBe(200);

    // b can no longer refresh; a still can.
    expect((await doRefresh(b.refreshToken)).statusCode).toBe(401);
    expect((await doRefresh(a.refreshToken)).statusCode).toBe(200);
  });

  it('revoke-others keeps the current session and kills the rest', async () => {
    const a = await loginAsRole(app, 'SECURITY');
    const b = await loginAsRole(app, 'SECURITY');
    const bSid = sessionsOf((await listSessions(b.accessToken)).body).find((s) => s.current)!.id;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/sessions/revoke-others',
      headers: authHeaders(a.accessToken),
    });
    expect(res.statusCode).toBe(200);

    // b (another device) is gone; a keeps its own current session.
    expect((await doRefresh(b.refreshToken)).statusCode).toBe(401);
    const list = sessionsOf((await listSessions(a.accessToken)).body);
    expect(list.find((s) => s.current)).toBeDefined();
    expect(list.some((s) => s.id === bSid)).toBe(false);
  });

  it('refresh rotates the token but keeps a single current session', async () => {
    const a = await loginAsRole(app, 'OPERATOR');
    const r = await doRefresh(a.refreshToken);
    expect(r.statusCode).toBe(200);
    const newAccess = JSON.parse(r.body).data.access_token as string;

    // The rotated access token still resolves to exactly one current session…
    expect(sessionsOf((await listSessions(newAccess)).body).filter((s) => s.current)).toHaveLength(1);
    // …and the old refresh token is now dead (rotation revoked its row).
    expect((await doRefresh(a.refreshToken)).statusCode).toBe(401);
  });

  it('changing your own password signs out every other session but keeps the current one', async () => {
    // A dedicated throwaway user (not the shared role fixtures) so mutating its
    // password can't affect any other test in this sequential suite.
    const owner = await loginAsRole(app, 'OWNER');
    const email = `change-pw-probe-${Date.now()}@coldchain.pk`;
    const create = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(owner.accessToken),
      payload: { email, name: 'Change PW Probe', role: 'OPERATOR', initial_password: 'probe-initial-1' },
    });
    expect(create.statusCode).toBe(201);
    const userId = JSON.parse(create.body).data.id as string;

    const loginAsProbe = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, password },
      });

    const aRes = await loginAsProbe('probe-initial-1');
    const bRes = await loginAsProbe('probe-initial-1'); // same user, another device
    const a = JSON.parse(aRes.body).data as { access_token: string; refresh_token: string };
    const b = JSON.parse(bRes.body).data as { access_token: string; refresh_token: string };

    const change = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: authHeaders(a.access_token),
      payload: { current_password: 'probe-initial-1', new_password: 'probe-changed-1' },
    });
    expect(change.statusCode).toBe(200);

    // b (the other device) is signed out...
    expect((await doRefresh(b.refresh_token)).statusCode).toBe(401);
    // ...but a (the device that made the change) is not.
    expect((await doRefresh(a.refresh_token)).statusCode).toBe(200);

    // Best-effort cleanup — the user has refresh_token rows referencing it, so
    // deletion can be FK-blocked; leaving the throwaway probe behind is harmless.
    await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('admin can list and force-revoke another user\'s sessions; non-admin is denied', async () => {
    const owner = await loginAsRole(app, 'OWNER');
    const subject = await loginAsRole(app, 'SECURITY');
    const subjectId = JSON.parse(
      (await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(subject.accessToken) })).body,
    ).data.id as string;

    const list = await app.inject({
      method: 'GET',
      url: `/v1/users/${subjectId}/sessions`,
      headers: authHeaders(owner.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(sessionsOf(list.body).length).toBeGreaterThan(0);
    // Admin view never marks a session "current" (it's not the admin's device).
    expect(sessionsOf(list.body).every((s) => s.current === false)).toBe(true);

    // A non-admin cannot view another user's sessions.
    const denied = await app.inject({
      method: 'GET',
      url: `/v1/users/${subjectId}/sessions`,
      headers: authHeaders(subject.accessToken),
    });
    expect(denied.statusCode).toBe(403);

    // Force sign-out revokes every session; the user can no longer refresh.
    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/users/${subjectId}/sessions/revoke-all`,
      headers: authHeaders(owner.accessToken),
    });
    expect(revoke.statusCode).toBe(200);
    expect((await doRefresh(subject.refreshToken)).statusCode).toBe(401);
  });
});
