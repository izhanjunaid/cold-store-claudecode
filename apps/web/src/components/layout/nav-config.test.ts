import { describe, expect, it } from 'vitest';
import { navGroupsForRole, navItemsForRole, navLabelForPath } from './nav-config';

function hrefs(role: string): string[] {
  return navItemsForRole(role).map((i) => i.href);
}

describe('navGroupsForRole', () => {
  it('shows everything to OWNER', () => {
    const items = hrefs('OWNER');
    expect(items).toContain('/dashboard');
    expect(items).toContain('/settings');
    expect(items).toContain('/accounting');
    expect(items).toContain('/gate');
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

  it('hides MANAGER-gated settings from ACCOUNTANT but shows finance', () => {
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
    const groups = navGroupsForRole('VIEWER');
    expect(groups.find((g) => g.label === 'Admin')).toBeUndefined();
    expect(groups.find((g) => g.label === 'Finance')).toBeUndefined();
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
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
