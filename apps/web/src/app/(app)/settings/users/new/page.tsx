'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

const ROLES = ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR', 'SECURITY'];

export default function NewUserPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nameUrdu, setNameUrdu] = useState('');
  const [role, setRole] = useState('OPERATOR');
  const [initialPassword, setInitialPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (initialPassword.length < 8) {
      setError('Initial password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiClient<{ id: string }>('/v1/users', {
        method: 'POST',
        body: {
          email,
          name,
          name_urdu: nameUrdu.trim() || null,
          role,
          initial_password: initialPassword,
        },
      });
      router.push(`/settings/users/${created.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <button onClick={() => router.push('/settings/users')} className="text-sm text-blue-600 hover:underline mb-4">
        ← Back to users
      </button>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Create User</h1>
      <form onSubmit={submit} className="bg-white rounded-lg shadow p-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Email *</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            required
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Name (Urdu, optional)</span>
          <input
            type="text"
            value={nameUrdu}
            onChange={(e) => setNameUrdu((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2"
            dir="rtl"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Role *</span>
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
        <label className="block">
          <span className="text-sm font-medium text-gray-700">Initial Password *</span>
          <input
            type="text"
            value={initialPassword}
            onChange={(e) => setInitialPassword((e.target as HTMLInputElement).value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 font-mono"
            required
            minLength={8}
          />
          <span className="text-xs text-gray-500 mt-1 block">
            User will be required to change this on first login.
          </span>
        </label>
        {error && <div className="text-red-700 bg-red-50 px-3 py-2 rounded text-sm">{error}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push('/settings/users')}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );
}
