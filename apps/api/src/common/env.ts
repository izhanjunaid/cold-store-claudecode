// Hardcoded fallbacks in jwt.ts / crypto.ts — a production box that never set
// the real env vars would silently run with these, making JWTs forgeable.
const DEV_JWT_SECRET = 'dev-secret';
const DEV_JWT_REFRESH_SECRET = 'dev-refresh-secret';

export interface EnvLike {
  NODE_ENV?: string;
  JWT_SECRET?: string;
  JWT_REFRESH_SECRET?: string;
  APP_ENCRYPTION_KEY?: string;
}

export interface EnvLogger {
  warn: (message: string) => void;
}

/**
 * Fail fast on boot rather than run production with forgeable/default secrets.
 * Called once from server.ts (not app.ts, so the test app — which never sets
 * NODE_ENV=production — is unaffected).
 */
export function validateEnv(env: EnvLike, logger: EnvLogger = console): void {
  if (env.NODE_ENV === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET === DEV_JWT_SECRET) {
      throw new Error(
        'JWT_SECRET is missing or set to the dev default — refusing to boot in production. Set a strong random value (e.g. `openssl rand -hex 48`).',
      );
    }
    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET === DEV_JWT_REFRESH_SECRET) {
      throw new Error(
        'JWT_REFRESH_SECRET is missing or set to the dev default — refusing to boot in production. Set a strong random value (e.g. `openssl rand -hex 48`).',
      );
    }
    if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
    }
  }

  if (!env.APP_ENCRYPTION_KEY) {
    logger.warn(
      'APP_ENCRYPTION_KEY is not set — the encryption key for stored secrets (SMTP passwords, TOTP secrets, email API keys) is derived from JWT_SECRET instead. Rotating JWT_SECRET will invalidate them. Set APP_ENCRYPTION_KEY explicitly (e.g. `openssl rand -hex 32`) to avoid this coupling.',
    );
  }
}
