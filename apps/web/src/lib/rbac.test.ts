import { describe, expect, it } from 'vitest';
import { ROLE_RANK, hasMinRole } from './rbac';

describe('rbac', () => {
  it('ranks roles in the documented hierarchy', () => {
    expect(ROLE_RANK.OWNER).toBeGreaterThan(ROLE_RANK.MANAGER);
    expect(ROLE_RANK.MANAGER).toBeGreaterThan(ROLE_RANK.ACCOUNTANT);
    expect(ROLE_RANK.ACCOUNTANT).toBeGreaterThan(ROLE_RANK.OPERATOR);
    expect(ROLE_RANK.OPERATOR).toBeGreaterThan(ROLE_RANK.SECURITY);
    expect(ROLE_RANK.SECURITY).toBeGreaterThan(ROLE_RANK.VIEWER);
  });

  it('allows equal and higher roles', () => {
    expect(hasMinRole('ACCOUNTANT', 'ACCOUNTANT')).toBe(true);
    expect(hasMinRole('OWNER', 'ACCOUNTANT')).toBe(true);
    expect(hasMinRole('MANAGER', 'SECURITY')).toBe(true);
  });

  it('rejects lower roles', () => {
    expect(hasMinRole('OPERATOR', 'ACCOUNTANT')).toBe(false);
    expect(hasMinRole('SECURITY', 'OPERATOR')).toBe(false);
    expect(hasMinRole('VIEWER', 'SECURITY')).toBe(false);
  });

  it('rejects unknown or missing roles', () => {
    expect(hasMinRole(undefined, 'VIEWER')).toBe(false);
    expect(hasMinRole(null, 'VIEWER')).toBe(false);
    expect(hasMinRole('SUPERADMIN', 'VIEWER')).toBe(false);
  });
});
