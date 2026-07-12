import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env['JWT_SECRET'] || 'dev-secret';
const JWT_REFRESH_SECRET = process.env['JWT_REFRESH_SECRET'] || 'dev-refresh-secret';

export interface JwtPayload {
  userId: string;
  facilityId: string;
  role: string;
}

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function signRefreshToken(payload: { userId: string; tokenId: string }): string {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '30d' });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & { purpose?: string };
  // Special-purpose tokens (e.g. the 2FA pending token) share the secret but
  // carry a `purpose` claim — they must never authenticate as access tokens.
  if (decoded.purpose) throw new Error('Not an access token');
  return decoded;
}

export function verifyRefreshToken(token: string): { userId: string; tokenId: string } {
  return jwt.verify(token, JWT_REFRESH_SECRET) as { userId: string; tokenId: string };
}

// Interim token between a successful password check and 2FA code verification.
export function signPendingTwoFactorToken(payload: { userId: string; facilityId: string }): string {
  return jwt.sign({ ...payload, purpose: '2fa_pending' }, JWT_SECRET, { expiresIn: '10m' });
}

export function verifyPendingTwoFactorToken(token: string): { userId: string; facilityId: string } {
  const decoded = jwt.verify(token, JWT_SECRET) as {
    userId: string;
    facilityId: string;
    purpose?: string;
  };
  if (decoded.purpose !== '2fa_pending') throw new Error('Not a 2FA pending token');
  return decoded;
}
