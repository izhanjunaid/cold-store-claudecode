'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

interface MeResponse {
  id: string;
  email: string;
  name: string;
  name_urdu: string | null;
  role: string;
  facility_id: string;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, user, setUser, loadFromStorage, logout } = useAuthStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    if (!isAuthenticated) {
      const token = localStorage.getItem('access_token');
      if (!token) {
        router.push('/login');
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
        .catch(() => {
          logout();
          router.push('/login');
        });
    }
  }, [isAuthenticated, user, router, setUser, logout]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Topbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
