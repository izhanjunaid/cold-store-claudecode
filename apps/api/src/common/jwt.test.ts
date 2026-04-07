import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken, signRefreshToken, verifyRefreshToken } from './jwt';

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
});
