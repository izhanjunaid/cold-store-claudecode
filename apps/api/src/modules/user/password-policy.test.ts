import { describe, it, expect } from 'vitest';
import { validateNewPassword, PASSWORD_MIN_LENGTH_DEFAULT } from '@coldchain/shared';

describe('validateNewPassword (NIST 800-63B-4: length + blocklist only)', () => {
  it('default minimum length is 10', () => {
    expect(PASSWORD_MIN_LENGTH_DEFAULT).toBe(10);
  });

  it('rejects passwords shorter than the minimum with the length reason', () => {
    const result = validateNewPassword('short1234');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least 10 characters/);
  });

  it('accepts a strong password of exactly the minimum length', () => {
    expect(validateNewPassword('kx92-mnq47').ok).toBe(true);
  });

  it('rejects blocklisted common passwords, case-insensitively', () => {
    for (const pw of ['password123', 'PASSWORD123', 'qwertyuiop', 'Welcome123']) {
      const result = validateNewPassword(pw);
      expect(result.ok, `${pw} should be rejected`).toBe(false);
      expect(result.reason).toMatch(/too common/);
    }
  });

  it('imposes NO composition rules — all-lowercase, all-digits, no-symbol passwords pass', () => {
    expect(validateNewPassword('kharbooza-mandi-lahore').ok).toBe(true);
    expect(validateNewPassword('83749284619273').ok).toBe(true);
  });

  it('honours a custom minimum length', () => {
    expect(validateNewPassword('short1234', { minLength: 8 }).ok).toBe(true);
    expect(validateNewPassword('short1234', { minLength: 15 }).ok).toBe(false);
  });
});
