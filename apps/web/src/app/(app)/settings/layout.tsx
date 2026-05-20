'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';

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
      <div className="bg-white rounded-lg shadow p-8 text-center">
        <h1 className="text-xl font-bold text-gray-900 mb-2">Access denied</h1>
        <p className="text-gray-600">Settings are OWNER-only.</p>
      </div>
    );
  }

  const nav = [
    { href: '/settings', label: 'General' },
    { href: '/settings/users', label: 'Users' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
      <aside className="bg-white rounded-lg shadow p-3 h-fit">
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
                className={`px-3 py-2 rounded text-sm font-medium ${
                  active ? 'bg-blue-100 text-blue-800' : 'text-gray-700 hover:bg-gray-100'
                }`}
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
