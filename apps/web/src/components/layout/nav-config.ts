import {
  Banknote,
  BarChart3,
  BookOpenText,
  Boxes,
  CircleDollarSign,
  DoorOpen,
  HandCoins,
  LayoutDashboard,
  PlusCircle,
  ReceiptText,
  Settings,
  Sprout,
  Tags,
  TrendingUp,
  UserPlus,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { can } from '@/lib/permissions';

interface UserLike {
  role?: string | null;
  permissions?: string[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Permission key(s) whose API access backs this screen. Item is shown when the
   * user holds ANY of them. Mirrors requirePermission in apps/api controllers —
   * nav hiding is a courtesy, never a substitute for in-page/API guards. Omit for
   * screens any authenticated user can open (reference data).
   */
  permission?: string | string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'reports.operational' },
      { label: 'Financial', href: '/dashboards/financial', icon: TrendingUp, permission: 'reports.financial' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Lots', href: '/lots', icon: Boxes },
      { label: 'Rooms', href: '/chambers', icon: Warehouse },
      { label: 'Commodities', href: '/commodities', icon: Sprout, permission: 'commodities.manage' },
      { label: 'Gate Pass', href: '/gate', icon: DoorOpen, permission: 'gate_passes.log' },
      // Quality (M6) has no UI yet — do not add a nav item until its page exists,
      // a link that 404s is worse than no link.
    ],
  },
  {
    label: 'Sales & Billing',
    items: [
      { label: 'Invoices', href: '/invoices', icon: ReceiptText, permission: 'billing.view' },
      { label: 'Payments', href: '/payments', icon: Banknote, permission: 'billing.view' },
      { label: 'Rate Plans', href: '/billing/rate-plans', icon: Tags },
      { label: 'Service Charges', href: '/billing/service-charges', icon: CircleDollarSign },
    ],
  },
  {
    label: 'Parties & Loans',
    items: [
      { label: 'Parties', href: '/parties', icon: Users },
      { label: 'Loans', href: '/loans', icon: HandCoins, permission: 'loans.view' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Accounting', href: '/accounting', icon: BookOpenText, permission: 'accounting.view' },
      {
        label: 'Reports',
        href: '/reports',
        icon: BarChart3,
        permission: ['reports.operational', 'reports.inventory', 'reports.financial', 'reports.seasonal'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      {
        label: 'Settings',
        href: '/settings',
        icon: Settings,
        permission: ['settings.manage', 'users.manage', 'permissions.manage', 'audit.view'],
      },
    ],
  },
];

/**
 * Common "create" destinations, surfaced as an Actions group in the command
 * palette so a create doesn't cost a detour through a list page first. Same
 * NavItem shape and permission mechanism as NAV_GROUPS — a courtesy filter,
 * not a substitute for the API's own guard.
 */
export const PALETTE_ACTIONS: NavItem[] = [
  { label: 'New Inbound', href: '/lots/new', icon: Boxes },
  { label: 'New Party', href: '/parties/new', icon: UserPlus },
  { label: 'Record Payment', href: '/payments/new', icon: Banknote, permission: 'billing.view' },
  {
    label: 'New Journal Entry',
    href: '/accounting/journal-entries/new',
    icon: BookOpenText,
    permission: 'accounting.view',
  },
  {
    label: 'New Expense',
    href: '/accounting/expenses/new',
    icon: PlusCircle,
    permission: 'expenses.record',
  },
  { label: 'Issue Loan', href: '/loans/issue', icon: HandCoins, permission: 'loans.view' },
];

/** Palette actions visible to a user (same permission rule as nav items). */
export function paletteActionsForUser(user: UserLike | null | undefined): NavItem[] {
  return PALETTE_ACTIONS.filter((item) => itemVisible(item, user));
}

function itemVisible(item: NavItem, user: UserLike | null | undefined): boolean {
  if (!item.permission) return true;
  const keys = Array.isArray(item.permission) ? item.permission : [item.permission];
  return keys.some((key) => can(user, key));
}

/** Nav groups visible to a user, with empty groups dropped. */
export function navGroupsForUser(user: UserLike | null | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => itemVisible(item, user)),
  })).filter((group) => group.items.length > 0);
}

/** Flat list of nav items visible to a user (used by the command palette). */
export function navItemsForUser(user: UserLike | null | undefined): NavItem[] {
  return navGroupsForUser(user).flatMap((g) => g.items);
}

/** Best-effort label for a path segment, used by breadcrumbs. */
export function navLabelForPath(path: string): string | undefined {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.href === path) return item.label;
    }
  }
  return undefined;
}
