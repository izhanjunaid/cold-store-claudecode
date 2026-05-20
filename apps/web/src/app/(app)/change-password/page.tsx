'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { defaultRouteForRole } from '@/lib/auth-redirect';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, setUser } = useAuthStore();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('New password and confirmation do not match');
      return;
    }
    if (next.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const updated = await apiClient<{ must_change_password: boolean }>(
        '/v1/auth/change-password',
        {
          method: 'POST',
          body: { current_password: current, new_password: next },
        },
      );
      // Refresh the stored user so the must_change_password flag clears.
      if (user) {
        const accessToken = localStorage.getItem('access_token') || '';
        const refreshToken = localStorage.getItem('refresh_token') || '';
        setUser(
          { ...user, must_change_password: updated.must_change_password },
          accessToken,
          refreshToken,
        );
      }
      router.push(defaultRouteForRole(user?.role));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Password change failed');
    } finally {
      setSubmitting(false);
    }
  }

  const forced = !!user?.must_change_password;

  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Change Password</h1>
      {forced ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
          You must change your password before continuing.
        </p>
      ) : (
        <p className="text-sm text-gray-500 mb-4">Update the password on your account.</p>
      )}
      <form onSubmit={submit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Current password</span>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">New password</span>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            required
            minLength={8}
          />
          <span className="text-xs text-gray-500 mt-1 block">Minimum 8 characters.</span>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            required
            minLength={8}
          />
        </label>
        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
