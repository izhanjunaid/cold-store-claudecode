import { describe, it, expect, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signPendingTwoFactorToken,
  verifyPendingTwoFactorToken,
} from './jwt';

describe('JWT utilities', () => {
  const payload = { userId: 'user-1', facilityId: 'fac-1', role: 'OWNER' };

  it('signs and verifies access token', () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.facilityId).toBe(payload.facilityId);
    expect(decoded.role).toBe(payload.role);
  });

  it('signs and verifies refresh token', () => {
    const refreshPayload = { userId: 'user-1', tokenId: 'tok-1' };
    const token = signRefreshToken(refreshPayload);
    const decoded = verifyRefreshToken(token);
    expect(decoded.userId).toBe(refreshPayload.userId);
    expect(decoded.tokenId).toBe(refreshPayload.tokenId);
  });

  it('rejects tampered access token', () => {
    const token = signAccessToken(payload);
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });

  it('rejects tampered refresh token', () => {
    const token = signRefreshToken({ userId: 'u1', tokenId: 't1' });
    expect(() => verifyRefreshToken(token + 'x')).toThrow();
  });

  it('signs and verifies a 2FA pending token', () => {
    const token = signPendingTwoFactorToken({ userId: 'user-1', facilityId: 'fac-1' });
    const decoded = verifyPendingTwoFactorToken(token);
    expect(decoded.userId).toBe('user-1');
    expect(decoded.facilityId).toBe('fac-1');
  });

  it('a 2FA pending token is NOT a valid access token', () => {
    const token = signPendingTwoFactorToken({ userId: 'user-1', facilityId: 'fac-1' });
    expect(() => verifyAccessToken(token)).toThrow('Not an access token');
  });

  it('an access token is NOT a valid 2FA pending token', () => {
    const token = signAccessToken(payload);
    expect(() => verifyPendingTwoFactorToken(token)).toThrow('Not a 2FA pending token');
  });

  describe('access token TTL', () => {
    afterEach(() => {
      delete process.env['JWT_ACCESS_TTL'];
    });

    const expOf = (token: string) => {
      const decoded = jwt.decode(token) as { exp: number; iat: number };
      return decoded.exp - decoded.iat;
    };

    it('defaults to 30 minutes', () => {
      expect(expOf(signAccessToken(payload))).toBe(30 * 60);
    });

    it('honours a JWT_ACCESS_TTL override', () => {
      process.env['JWT_ACCESS_TTL'] = '8h';
      expect(expOf(signAccessToken(payload))).toBe(8 * 60 * 60);
    });
  });
});
