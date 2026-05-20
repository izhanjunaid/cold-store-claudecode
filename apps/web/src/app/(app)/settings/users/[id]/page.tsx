'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import type { UserResponseType } from '@coldchain/shared';

const ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY'];

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params['id'] as string;

  const [user, setUser] = useState<UserResponseType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [isActive, setIsActive] = useState(true);

  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    apiClient<UserResponseType>(`/v1/users/${id}`)
      .then((u) => {
        setUser(u);
        setName(u.name);
        setNameUrdu(u.name_urdu ?? '');
        setRole(u.role);
        setIsActive(u.is_active);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    setError(null);
    try {
      const updated = await apiClient<UserResponseType>(`/v1/users/${id}`, {
        method: 'PATCH',
        body: {
          name,
          name_urdu: nameUrdu.trim() || null,
          role,
          is_active: isActive,
        },
      });
      setUser(updated);
      setSavedAt(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function resetPassword() {
    setResetError(null);
    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters');
      return;
    }
    setResetting(true);
    try {
      const updated = await apiClient<UserResponseType>(`/v1/users/${id}/reset-password`, {
        method: 'POST',
        body: { new_password: newPassword },
      });
      setUser(updated);
      setShowReset(false);
      setNewPassword('');
    } catch (e: unknown) {
      setResetError(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <div className="text-gray-500 p-4">Loading…</div>;
  if (error || !user)
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-red-700">{error ?? 'User not found'}</p>
      </div>
    );

  return (
    <div className="max-w-2xl space-y-4">
      <button onClick={() => router.push('/settings/users')} className="text-sm text-blue-600 hover:underline">
        ← Back to users
      </button>

      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <p className="text-sm text-gray-500">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowReset(true)}
            className="px-3 py-1.5 border rounded text-sm hover:bg-gray-50"
          >
            Reset Password
          </button>
          <button
            onClick={() => {
              setIsActive(false);
              save();
            }}
            disabled={!user.is_active}
            className="px-3 py-1.5 border border-red-300 text-red-700 rounded text-sm hover:bg-red-50 disabled:opacity-50"
          >
            {user.is_active ? 'Deactivate' : 'Deactivated'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name (Urdu)</span>
          <input
            type="text"
            value={nameUrdu}
            onChange={(e) => setNameUrdu((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            dir="rtl"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Role</span>
          <select
            value={role}
            onChange={(e) => setRole((e.target as HTMLSelectElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive((e.target as HTMLInputElement).checked)}
          />
          <span className="text-sm font-medium text-gray-700">Active</span>
        </label>

        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
        {savedAt && (
          <div className="text-emerald-700 bg-emerald-50 px-3 py-2 rounded text-sm">
            Saved at {new Date(savedAt).toLocaleTimeString()}
          </div>
        )}

        <div>
          <button
            onClick={save}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Save Changes
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="font-semibold text-gray-900 mb-2">Account Info</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Created</dt>
          <dd>{new Date(user.created_at).toLocaleString()}</dd>
          <dt className="text-gray-500">Last Login</dt>
          <dd>{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : '—'}</dd>
          <dt className="text-gray-500">Must Change Password</dt>
          <dd>{user.must_change_password ? 'Yes' : 'No'}</dd>
        </dl>
      </div>

      {showReset && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50" onClick={() => setShowReset(false)}>
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Reset Password</h2>
            <p className="text-sm text-gray-600 mb-4">
              The user will be required to change the password on next login. All existing sessions will be revoked.
            </p>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">New Password</span>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword((e.target as HTMLInputElement).value)}
                className="mt-1 w-full border rounded-lg px-3 py-2 font-mono"
                minLength={8}
                autoFocus
              />
            </label>
            {resetError && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm mt-3">{resetError}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowReset(false)} className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm">
                Cancel
              </button>
              <button
                onClick={resetPassword}
                disabled={resetting}
                className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
