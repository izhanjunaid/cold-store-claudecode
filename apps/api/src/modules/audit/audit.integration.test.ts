import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let ownerName: string;
let operatorToken: string;
let createdUserId: string | null = null;

// A controlled audit row we insert directly so masking + actor-name resolution
// can be asserted deterministically (independent of which writes the DB trigger
// happens to attribute). audit_log is append-only (migration 0002), so the row
// can't be cleaned up — a fresh record id per run keeps the assertion exact.
const PROBE_TABLE = 'audit_probe';
const PROBE_RECORD = randomUUID();

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  ownerName = owner.user.name;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;

  await prisma.auditLog.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      tableName: PROBE_TABLE,
      recordId: PROBE_RECORD,
      action: 'UPDATE',
      changedBy: owner.user.id,
      oldValues: {
        password_hash: 'bcrypt-old',
        smtp_password_enc: 'cipher-old',
        api_key_enc: 'cipher-old',
        totp_secret_enc: 'cipher-old',
        token_hash: 'hash-old',
        name: 'Before',
      },
      newValues: {
        password_hash: 'bcrypt-new',
        smtp_password_enc: 'cipher-new',
        api_key_enc: 'cipher-new',
        totp_secret_enc: 'cipher-new',
        token_hash: 'hash-new',
        name: 'After',
      },
    },
  });
});

afterAll(async () => {
  // audit_log is append-only, so the probe row can't be deleted; the throwaway
  // user has no dependents and its DELETE writes no audit row (no DELETE branch).
  if (createdUserId) await prisma.user.delete({ where: { id: createdUserId } }).catch(() => {});
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Activity log API', () => {
  it('is readable by audit.view (OWNER) and denied otherwise (403)', async () => {
    const denied = await app.inject({ method: 'GET', url: '/v1/audit-logs', headers: authHeaders(operatorToken) });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({ method: 'GET', url: '/v1/audit-logs', headers: authHeaders(ownerToken) });
    expect(ok.statusCode).toBe(200);
    const body = JSON.parse(ok.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toMatchObject({ page: 1, per_page: 50 });
  });

  it('masks every secret-bearing field and resolves the actor name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit-logs?table_name=${PROBE_TABLE}&record_id=${PROBE_RECORD}`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{
      old_values: Record<string, unknown>;
      new_values: Record<string, unknown>;
      changed_by_name: string | null;
    }>;
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    // Every credential-bearing field is redacted, in old and new snapshots;
    // non-secret fields survive.
    expect(row.new_values['password_hash']).toBe('***');
    expect(row.new_values['smtp_password_enc']).toBe('***');
    expect(row.new_values['api_key_enc']).toBe('***');
    expect(row.new_values['totp_secret_enc']).toBe('***');
    expect(row.new_values['token_hash']).toBe('***');
    expect(row.old_values['password_hash']).toBe('***');
    expect(row.old_values['api_key_enc']).toBe('***');
    expect(row.new_values['name']).toBe('After');
    // changed_by is batch-resolved to the acting user's name.
    expect(row.changed_by_name).toBe(ownerName);
  });

  it('records a real users INSERT with the password hash masked', async () => {
    const email = `audit-mask-${Date.now()}@coldchain.pk`;
    const create = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Audit Mask Probe', role: 'OPERATOR', initial_password: 'probe12345' },
    });
    expect(create.statusCode).toBe(201);
    createdUserId = JSON.parse(create.body).data.id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit-logs?table_name=users&action=INSERT&record_id=${createdUserId}&per_page=5`,
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ new_values: Record<string, unknown>; action: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.action).toBe('INSERT');
    expect(rows[0]!.new_values['password_hash']).toBe('***');
    expect(rows[0]!.new_values['email']).toBe(email);
  });

  it('filters by table and honours per_page pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit-logs?table_name=users&per_page=3',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.meta.per_page).toBe(3);
    expect(body.data.length).toBeLessThanOrEqual(3);
    expect(body.meta.total).toBeGreaterThanOrEqual(body.data.length);
    expect(body.data.every((r: { table_name: string }) => r.table_name === 'users')).toBe(true);
  });
});
