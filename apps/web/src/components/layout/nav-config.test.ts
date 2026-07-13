import { describe, expect, it } from 'vitest';
import { navGroupsForUser, navItemsForUser, navLabelForPath } from './nav-config';
import { defaultPermissionsForRole, type Role } from '@coldchain/shared';

// Build a user with the DEFAULT effective permissions for a role, matching how
// the server computes them with no overrides. This keeps the nav test aligned
// with the real permission source instead of a hand-maintained role rank.
function userFor(role: Role) {
  return { role, permissions: defaultPermissionsForRole(role) };
}

function hrefs(role: Role): string[] {
  return navItemsForUser(userFor(role)).map((i) => i.href);
}

describe('navGroupsForUser', () => {
  it('shows everything to OWNER', () => {
    const items = hrefs('OWNER');
    expect(items).toContain('/dashboard');
    expect(items).toContain('/settings');
    expect(items).toContain('/accounting');
    expect(items).toContain('/gate');
  });

  it('never links to /quality — the Quality module has no page yet', () => {
    for (const role of ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY'] as Role[]) {
      expect(hrefs(role)).not.toContain('/quality');
    }
  });

  it('hides admin and finance from OPERATOR', () => {
    const items = hrefs('OPERATOR');
    expect(items).toContain('/lots');
    expect(items).toContain('/dashboard');
    expect(items).not.toContain('/settings');
    expect(items).not.toContain('/invoices');
    expect(items).not.toContain('/payments');
    expect(items).not.toContain('/loans');
    expect(items).not.toContain('/accounting');
  });

  it('shows gate to SECURITY but not dashboard', () => {
    const items = hrefs('SECURITY');
    expect(items).toContain('/gate');
    expect(items).not.toContain('/dashboard');
    expect(items).not.toContain('/quality');
  });

  it('hides admin settings from ACCOUNTANT but shows finance', () => {
    const items = hrefs('ACCOUNTANT');
    expect(items).toContain('/invoices');
    expect(items).toContain('/payments');
    expect(items).toContain('/loans');
    expect(items).toContain('/accounting');
    expect(items).toContain('/reports');
    expect(items).toContain('/dashboards/financial');
    expect(items).not.toContain('/settings');
  });

  it('drops groups that end up empty', () => {
    const groups = navGroupsForUser(userFor('VIEWER'));
    expect(groups.find((g) => g.label === 'Admin')).toBeUndefined();
    expect(groups.find((g) => g.label === 'Finance')).toBeUndefined();
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });

  it('reflects a granted permission (owner customization)', () => {
    // Grant an OPERATOR the accounting.view key → Accounting appears.
    const user = { role: 'OPERATOR' as Role, permissions: [...defaultPermissionsForRole('OPERATOR'), 'accounting.view'] };
    expect(navItemsForUser(user).map((i) => i.href)).toContain('/accounting');
  });
});

describe('navLabelForPath', () => {
  it('resolves known paths', () => {
    expect(navLabelForPath('/lots')).toBe('Lots');
    expect(navLabelForPath('/billing/rate-plans')).toBe('Rate Plans');
  });

  it('returns undefined for unknown paths', () => {
    expect(navLabelForPath('/nonexistent')).toBeUndefined();
  });
});
