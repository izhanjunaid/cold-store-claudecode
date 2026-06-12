import {
  Banknote,
  BarChart3,
  BookOpenText,
  Boxes,
  CircleDollarSign,
  DoorOpen,
  HandCoins,
  LayoutDashboard,
  ReceiptText,
  Settings,
  ShieldCheck,
  Tags,
  TrendingUp,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { hasMinRole, type Role } from '@/lib/rbac';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Minimum role whose API GET access works for this screen. Mirrors
   * requireMinRole in apps/api controllers — nav hiding is a courtesy,
   * never a substitute for in-page guards.
   */
  minRole?: Role;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, minRole: 'OPERATOR' },
      { label: 'Financial', href: '/dashboards/financial', icon: TrendingUp, minRole: 'ACCOUNTANT' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Lots', href: '/lots', icon: Boxes },
      { label: 'Chambers', href: '/chambers', icon: Warehouse },
      { label: 'Gate Pass', href: '/gate', icon: DoorOpen, minRole: 'SECURITY' },
      { label: 'Quality', href: '/quality', icon: ShieldCheck, minRole: 'OPERATOR' },
    ],
  },
  {
    label: 'Sales & Billing',
    items: [
      { label: 'Invoices', href: '/invoices', icon: ReceiptText, minRole: 'ACCOUNTANT' },
      { label: 'Payments', href: '/payments', icon: Banknote, minRole: 'ACCOUNTANT' },
      { label: 'Rate Plans', href: '/billing/rate-plans', icon: Tags },
      { label: 'Service Charges', href: '/billing/service-charges', icon: CircleDollarSign },
    ],
  },
  {
    label: 'Parties & Loans',
    items: [
      { label: 'Parties', href: '/parties', icon: Users },
      { label: 'Loans', href: '/loans', icon: HandCoins, minRole: 'ACCOUNTANT' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Accounting', href: '/accounting', icon: BookOpenText, minRole: 'ACCOUNTANT' },
      { label: 'Reports', href: '/reports', icon: BarChart3, minRole: 'ACCOUNTANT' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings, minRole: 'MANAGER' },
    ],
  },
];

/** Nav groups visible to a role, with empty groups dropped. */
export function navGroupsForRole(role: string | undefined | null): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.minRole || hasMinRole(role, item.minRole)),
  })).filter((group) => group.items.length > 0);
}

/** Flat list of nav items visible to a role (used by the command palette). */
export function navItemsForRole(role: string | undefined | null): NavItem[] {
  return navGroupsForRole(role).flatMap((g) => g.items);
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
