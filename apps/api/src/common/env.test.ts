import { describe, it, expect, vi } from 'vitest';
import { validateEnv } from './env';

function logger() {
  return { warn: vi.fn() };
}

describe('validateEnv', () => {
  it('does not throw in development even with no secrets set', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' }, logger())).not.toThrow();
  });

  it('does not throw in test env', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' }, logger())).not.toThrow();
  });

  it('throws in production when JWT_SECRET is missing', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', JWT_REFRESH_SECRET: 'a-real-refresh-secret' }, logger()),
    ).toThrow(/JWT_SECRET/);
  });

  it('throws in production when JWT_REFRESH_SECRET is missing', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'a-real-secret' }, logger()),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('throws in production when JWT_SECRET is the hardcoded dev fallback', () => {
    expect(() =>
      validateEnv(
        { NODE_ENV: 'production', JWT_SECRET: 'dev-secret', JWT_REFRESH_SECRET: 'a-real-refresh-secret' },
        logger(),
      ),
    ).toThrow(/dev default/);
  });

  it('throws in production when JWT_REFRESH_SECRET is the hardcoded dev fallback', () => {
    expect(() =>
      validateEnv(
        { NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', JWT_REFRESH_SECRET: 'dev-refresh-secret' },
        logger(),
      ),
    ).toThrow(/dev default/);
  });

  it('throws in production when the two secrets are equal', () => {
    expect(() =>
      validateEnv(
        { NODE_ENV: 'production', JWT_SECRET: 'same-value-same-value', JWT_REFRESH_SECRET: 'same-value-same-value' },
        logger(),
      ),
    ).toThrow(/must be different/);
  });

  it('does not throw in production with two distinct, non-default secrets', () => {
    expect(() =>
      validateEnv(
        { NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', JWT_REFRESH_SECRET: 'a-real-refresh-secret' },
        logger(),
      ),
    ).not.toThrow();
  });

  it('warns (does not throw) when APP_ENCRYPTION_KEY is absent', () => {
    const log = logger();
    validateEnv(
      { NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', JWT_REFRESH_SECRET: 'a-real-refresh-secret' },
      log,
    );
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]?.[0]).toMatch(/APP_ENCRYPTION_KEY/);
  });

  it('does not warn when APP_ENCRYPTION_KEY is set', () => {
    const log = logger();
    validateEnv(
      {
        NODE_ENV: 'production',
        JWT_SECRET: 'a-real-secret',
        JWT_REFRESH_SECRET: 'a-real-refresh-secret',
        APP_ENCRYPTION_KEY: 'a-real-encryption-key',
      },
      log,
    );
    expect(log.warn).not.toHaveBeenCalled();
  });
});
