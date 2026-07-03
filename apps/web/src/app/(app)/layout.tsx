'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { useAuthStore } from '@/stores/auth.store';
import { ApiError, apiClient } from '@/lib/api-client';
import { Providers } from './providers';

interface MeResponse {
  id: string;
  email: string;
  name: string;
  name_urdu: string | null;
  role: string;
  facility_id: string;
  must_change_password?: boolean;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, user, setUser, loadFromStorage, logout } = useAuthStore();
  const [meRetry, setMeRetry] = useState(0);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isAuthenticated) {
      const token = localStorage.getItem('access_token');
      if (!token) {
        // Never signed in (or signed out): go to login, remembering the destination.
        const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
        router.push(`/login${next}`);
        return;
      }
    }

    if (isAuthenticated && !user) {
      apiClient<MeResponse>('/v1/auth/me')
        .then((me) => {
          const accessToken = localStorage.getItem('access_token') || '';
          const refreshToken = localStorage.getItem('refresh_token') || '';
          setUser(me, accessToken, refreshToken);
        })
        .catch((err) => {
          // Only end the session when the API says the token is bad. A network
          // hiccup or an API restart must not wipe a valid session — the next
          // render retries /me instead.
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            logout();
            router.push(`/login?expired=1&next=${encodeURIComponent(pathname ?? '/')}`);
          } else {
            // Transient failure (API restarting, network blip): retry shortly.
            setTimeout(() => setMeRetry((n) => n + 1), 2000);
          }
        });
    }
  }, [isAuthenticated, user, pathname, router, setUser, logout, meRetry]);

  // Force users with must_change_password to the change-password page.
  useEffect(() => {
    if (user && user.must_change_password && pathname !== '/change-password') {
      router.push('/change-password');
    }
  }, [user, pathname, router]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Providers>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 p-6">
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </Providers>
  );
}
