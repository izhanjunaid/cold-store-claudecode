'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; permission: string }[] = [
  { href: '/settings', label: 'General', permission: 'settings.manage' },
  { href: '/settings/email', label: 'Email', permission: 'settings.manage' },
  { href: '/settings/notifications', label: 'Notifications', permission: 'settings.manage' },
  { href: '/settings/users', label: 'Users', permission: 'users.manage' },
  { href: '/settings/permissions', label: 'Permissions', permission: 'permissions.manage' },
  { href: '/settings/activity', label: 'Activity Log', permission: 'audit.view' },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();

  const visible = NAV.filter((item) => can(user, item.permission));
  const hasAnyAccess = visible.length > 0;

  useEffect(() => {
    if (user && !hasAnyAccess) router.push('/dashboard');
  }, [user, hasAnyAccess, router]);

  if (!user) return null;
  if (!hasAnyAccess) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <h1 className="mb-2 text-lg font-semibold">Access denied</h1>
          <p className="text-muted-foreground">You do not have access to any settings.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      <aside className="h-fit">
        <nav className="flex flex-col gap-1">
          {visible.map((item) => {
            const active =
              item.href === '/settings'
                ? pathname === '/settings'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div>{children}</div>
    </div>
  );
}
