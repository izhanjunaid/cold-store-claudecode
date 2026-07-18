import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword, needsRehash } from './password';

describe('hashPassword / verifyPassword (argon2id)', () => {
  it('round-trips: hashes then verifies the same password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('uses OWASP-recommended cost parameters', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash).toContain('m=19456,t=2,p=1');
  });

  it('produces a hash that fits users.password_hash VARCHAR(200)', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.length).toBeLessThan(200);
  });

  it('still verifies a legacy bcrypt hash (dispatches on the $2 prefix)', async () => {
    const legacyHash = await bcrypt.hash('legacy-password', 12);
    expect(await verifyPassword('legacy-password', legacyHash)).toBe(true);
    expect(await verifyPassword('wrong-password', legacyHash)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('is true for a legacy bcrypt hash', async () => {
    const legacyHash = await bcrypt.hash('legacy-password', 12);
    expect(needsRehash(legacyHash)).toBe(true);
  });

  it('is false for an argon2id hash', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(needsRehash(hash)).toBe(false);
  });
});
