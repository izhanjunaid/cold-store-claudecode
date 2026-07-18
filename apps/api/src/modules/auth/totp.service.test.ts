import { describe, it, expect } from 'vitest';
import { generate } from 'otplib';
import {
  generateTotpSecret,
  buildOtpauthUri,
  verifyTotpToken,
  generateBackupCode,
  normalizeBackupCode,
  looksLikeBackupCode,
  TOTP_EPOCH_TOLERANCE_SECONDS,
} from './totp.service';

describe('TOTP primitives', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('builds a scannable otpauth URI carrying issuer and account label', () => {
    const uri = buildOtpauthUri('owner@coldchain.pk', 'Lahore Cold Store', 'ABCDEFGHABCDEFGH');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=Lahore');
    expect(uri).toContain('secret=ABCDEFGHABCDEFGH');
    expect(uri).toContain('owner%40coldchain.pk');
  });

  it('verifies a token computed from the same secret', async () => {
    const secret = generateTotpSecret();
    const token = await generate({ secret });
    expect(await verifyTotpToken(token, secret)).toBe(true);
  });

  it('rejects a token from a different secret', async () => {
    const token = await generate({ secret: generateTotpSecret() });
    expect(await verifyTotpToken(token, generateTotpSecret())).toBe(false);
  });

  it('tolerates one adjacent 30s time step (clock skew)', async () => {
    const secret = generateTotpSecret();
    const previousStep = await generate({
      secret,
      epoch: Math.floor(Date.now() / 1000) - TOTP_EPOCH_TOLERANCE_SECONDS,
    });
    expect(await verifyTotpToken(previousStep, secret)).toBe(true);
  });

  it('rejects a token from far outside the tolerance window', async () => {
    const secret = generateTotpSecret();
    const stale = await generate({ secret, epoch: Math.floor(Date.now() / 1000) - 300 });
    expect(await verifyTotpToken(stale, secret)).toBe(false);
  });

  it('does not throw on garbage token input', async () => {
    expect(await verifyTotpToken('not-a-token', generateTotpSecret())).toBe(false);
  });
});

describe('backup codes', () => {
  it('generates XXXX-XXXX codes from the unambiguous alphabet', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateBackupCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('normalizes case and separators', () => {
    expect(normalizeBackupCode('ab3d-ef7h')).toBe('AB3DEF7H');
    expect(normalizeBackupCode('AB3D EF7H')).toBe('AB3DEF7H');
    expect(normalizeBackupCode('ab3def7h')).toBe('AB3DEF7H');
  });

  it('classifies code shapes: 6-digit codes are not backup codes; XXXX-XXXX are', () => {
    expect(looksLikeBackupCode('123456')).toBe(false);
    expect(looksLikeBackupCode(generateBackupCode())).toBe(true);
    expect(looksLikeBackupCode('AB3DEF7H')).toBe(true);
  });
});
