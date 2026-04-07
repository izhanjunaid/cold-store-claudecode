'use client';

import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';

export function Topbar() {
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    try {
      await apiClient('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Logout even if API fails
    }
    logout();
    router.push('/login');
  };

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <div className="text-sm text-gray-500">
        Lahore Cold Store
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <>
            <span className="text-sm text-gray-700">{user.name}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary-100 text-primary-800 font-medium">
              {user.role}
            </span>
          </>
        )}
        <button
          onClick={handleLogout}
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
