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

  it('shows the dispatch desk to whoever can book withdrawals, not to the guard', () => {
    expect(hrefs('OPERATOR')).toContain('/dispatch');
    expect(hrefs('MANAGER')).toContain('/dispatch');
    expect(hrefs('SECURITY')).not.toContain('/dispatch');
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

  it('lists Rate Plans and Service Charges only for those who read billing or manage them — not the guard or the munshi', () => {
    for (const role of ['SECURITY', 'OPERATOR'] as Role[]) {
      expect(hrefs(role)).not.toContain('/billing/rate-plans');
      expect(hrefs(role)).not.toContain('/billing/service-charges');
    }
    for (const role of ['ACCOUNTANT', 'MANAGER', 'OWNER'] as Role[]) {
      expect(hrefs(role)).toContain('/billing/rate-plans');
      expect(hrefs(role)).toContain('/billing/service-charges');
    }
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
