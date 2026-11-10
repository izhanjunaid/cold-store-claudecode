import { describe, it, expect, vi } from 'vitest';
import { attemptsByPlate } from './count-attempts';

// Row-level security guards `users` (and facilities, refresh_tokens, audit_log, otp_codes) by the request's
// `app.facility_id`. The facility-scope extension stamps that setting for model operations and interactive
// transactions only, so a raw query on the plain client runs without it: under the restricted app role a join to
// `users` returns no names, or fails outright when a pooled connection still holds an empty setting. The
// integration suite connects as the table owner, who bypasses RLS, so only a test of the query itself can pin this.
describe('attemptsByPlate', () => {
  const fakeDb = () => {
    const sql: string[] = [];
    const db = {
      $queryRawUnsafe: vi.fn(async (query: string) => {
        sql.push(query);
        return [
          { plate: 'LHR1234', declared: 41, expected: 50, created_at: new Date('2026-11-01T09:00:00Z'), created_by: 'u-1' },
          { plate: 'LHR1234', declared: 44, expected: 50, created_at: new Date('2026-11-01T09:05:00Z'), created_by: 'u-2' },
        ];
      }),
      user: {
        findMany: vi.fn(async () => [
          { id: 'u-1', name: 'Bilal' },
          { id: 'u-2', name: 'Imran' },
        ]),
      },
    };
    return { db, sql };
  };

  it('never joins an RLS-protected table in raw SQL: the counters are named by a model query', async () => {
    const { db, sql } = fakeDb();

    const byPlate = await attemptsByPlate(db as never, 'facility-1', ['LHR1234']);

    expect(sql).toHaveLength(1);
    expect(sql[0]).not.toMatch(/\b(users|facilities|refresh_tokens|audit_log|otp_codes)\b/i);
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-1', 'u-2'] } }, select: { id: true, name: true } });
    expect(byPlate.get('LHR1234')!.map((a) => [a.declaredQuantity, a.countedBy?.name])).toEqual([
      [41, 'Bilal'],
      [44, 'Imran'],
    ]);
  });

  it('reads no names, and asks for none, when no plate has a count', async () => {
    const db = { $queryRawUnsafe: vi.fn(async () => []), user: { findMany: vi.fn() } };

    expect((await attemptsByPlate(db as never, 'facility-1', ['LHR1234'])).size).toBe(0);
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
