import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto';

describe('crypto secret encryption', () => {
  it('round-trips a secret', () => {
    const secret = 'gmail-app-password-1234';
    const payload = encryptSecret(secret);
    expect(payload).not.toContain(secret);
    expect(decryptSecret(payload)).toBe(secret);
  });

  it('produces a different ciphertext per call (random IV)', () => {
    const a = encryptSecret('same-value');
    const b = encryptSecret('same-value');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-value');
    expect(decryptSecret(b)).toBe('same-value');
  });

  it('rejects tampered payloads (gcm auth tag)', () => {
    const payload = encryptSecret('secret');
    const [iv, tag, data] = payload.split('.');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret(`${iv}.${tag}.${flipped.toString('base64')}`)).toThrow();
  });

  it('rejects malformed payloads', () => {
    expect(() => decryptSecret('not-a-payload')).toThrow('Malformed encrypted secret');
    expect(() => decryptSecret('a.b')).toThrow('Malformed encrypted secret');
  });

  it('handles unicode secrets', () => {
    const secret = 'پاس ورڈ £€ 密码';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
