'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const isOwner = user?.role === 'OWNER';

  useEffect(() => {
    if (user && !isOwner) router.push('/dashboard');
  }, [user, isOwner, router]);

  if (!user) return null;
  if (!isOwner) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <h1 className="mb-2 text-lg font-semibold">Access denied</h1>
          <p className="text-muted-foreground">Settings are OWNER-only.</p>
        </CardContent>
      </Card>
    );
  }

  const nav = [
    { href: '/settings', label: 'General' },
    { href: '/settings/email', label: 'Email' },
    { href: '/settings/users', label: 'Users' },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
      <aside className="h-fit">
        <nav className="flex flex-col gap-1">
          {nav.map((item) => {
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
