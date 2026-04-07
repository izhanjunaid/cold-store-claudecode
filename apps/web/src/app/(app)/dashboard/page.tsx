'use client';

import { useAuthStore } from '@/stores/auth.store';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-600">
          Welcome back, <span className="font-medium">{user?.name || 'User'}</span>.
        </p>
        <p className="text-sm text-gray-400 mt-2">
          Operational and financial dashboards will be built in Phase 10.
        </p>
      </div>
    </div>
  );
}
