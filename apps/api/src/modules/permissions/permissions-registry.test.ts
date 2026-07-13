import { describe, it, expect } from 'vitest';
import {
  PERMISSION_REGISTRY,
  ALL_PERMISSION_KEYS,
  ROLES,
  ROLE_RANK,
  defaultPermissionsForRole,
  computeEffectivePermissions,
  isAlwaysOwnerKey,
  type Role,
} from '@coldchain/shared';

describe('permission registry', () => {
  it('has unique keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('every alwaysOwner key defaults to OWNER', () => {
    for (const p of PERMISSION_REGISTRY) {
      if (p.alwaysOwner) expect(p.defaultMinRole).toBe('OWNER');
    }
  });
});

describe('parity with the pre-Phase-15 role hierarchy', () => {
  // The whole safety argument: with NO overrides, a role has a key iff its rank
  // met the old requireMinRole threshold. If this holds, swapping requireMinRole
  // for requirePermission cannot change who can reach any route.
  it('defaultPermissionsForRole(role) == { keys where rank(role) >= rank(defaultMinRole) }', () => {
    for (const role of ROLES) {
      const got = new Set(defaultPermissionsForRole(role));
      for (const p of PERMISSION_REGISTRY) {
        const shouldHave = ROLE_RANK[role] >= ROLE_RANK[p.defaultMinRole];
        expect(got.has(p.key), `${role} / ${p.key}`).toBe(shouldHave);
      }
    }
  });

  it('OWNER holds every key', () => {
    expect(new Set(defaultPermissionsForRole('OWNER'))).toEqual(new Set(ALL_PERMISSION_KEYS));
    expect(new Set(computeEffectivePermissions('OWNER', {}))).toEqual(new Set(ALL_PERMISSION_KEYS));
  });

  it('empty overrides == defaults for every role', () => {
    for (const role of ROLES) {
      expect(new Set(computeEffectivePermissions(role, {}))).toEqual(
        new Set(defaultPermissionsForRole(role)),
      );
    }
  });
});

describe('overrides', () => {
  it('grant adds a key to a role', () => {
    const eff = computeEffectivePermissions('ACCOUNTANT', {
      ACCOUNTANT: { grant: ['reports.seasonal'], revoke: [] },
    });
    expect(eff).toContain('reports.seasonal');
  });

  it('revoke removes a default key', () => {
    const eff = computeEffectivePermissions('ACCOUNTANT', {
      ACCOUNTANT: { grant: [], revoke: ['payments.record'] },
    });
    expect(eff).not.toContain('payments.record');
  });

  it('alwaysOwner keys can never be granted to a non-owner', () => {
    const alwaysOwner = PERMISSION_REGISTRY.filter((p) => p.alwaysOwner).map((p) => p.key);
    expect(alwaysOwner.length).toBeGreaterThan(0);
    for (const key of alwaysOwner) {
      const eff = computeEffectivePermissions('MANAGER', { MANAGER: { grant: [key], revoke: [] } });
      expect(eff).not.toContain(key);
    }
  });

  it('unknown keys cannot be granted', () => {
    const eff = computeEffectivePermissions('OPERATOR', {
      OPERATOR: { grant: ['not.a.real.key'], revoke: [] },
    });
    expect(eff).not.toContain('not.a.real.key');
  });

  it('isAlwaysOwnerKey reflects the registry', () => {
    expect(isAlwaysOwnerKey('permissions.manage')).toBe(true);
    expect(isAlwaysOwnerKey('parties.manage')).toBe(false);
  });
});

describe('spot checks vs known route thresholds', () => {
  const cases: Array<[string, Role, boolean]> = [
    ['parties.manage', 'OPERATOR', true],
    ['parties.delete', 'OPERATOR', false],
    ['parties.delete', 'MANAGER', true],
    ['payments.record', 'ACCOUNTANT', true],
    ['payments.record', 'OPERATOR', false],
    ['gate_passes.log', 'SECURITY', true],
    ['gate_passes.link_lot', 'SECURITY', false],
    ['gate_passes.link_lot', 'OPERATOR', true],
    ['invoices.write_off', 'MANAGER', false],
    ['accounting.view', 'ACCOUNTANT', true],
    ['accounting.post_journal', 'ACCOUNTANT', false],
    ['reports.seasonal', 'MANAGER', false],
    ['users.manage', 'MANAGER', false],
  ];
  it.each(cases)('%s reachable by %s == %s', (key, role, expected) => {
    expect(defaultPermissionsForRole(role).includes(key)).toBe(expected);
  });
});
