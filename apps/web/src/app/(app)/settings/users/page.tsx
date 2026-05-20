'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { UserResponseType } from '@coldchain/shared';
import { apiClientList, type PaginatedResult } from '@/lib/api-client';

const ROLE_BADGE: Record<string, string> = {
  OWNER: 'bg-purple-100 text-purple-800',
  MANAGER: 'bg-blue-100 text-blue-800',
  ACCOUNTANT: 'bg-emerald-100 text-emerald-800',
  OPERATOR: 'bg-amber-100 text-amber-800',
  SECURITY: 'bg-slate-100 text-slate-700',
};

export default function UsersListPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
  if (search.trim()) qs.set('search', search.trim());

  const { data, isLoading, refetch } = useQuery<PaginatedResult<UserResponseType>>({
    queryKey: ['users', page, search],
    queryFn: () => apiClientList<UserResponseType>(`/v1/users?${qs.toString()}`),
  });

  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <Link
          href="/settings/users/new"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Create User
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow p-4 flex items-center gap-3 text-sm">
        <input
          type="text"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => { setPage(1); setSearch((e.target as HTMLInputElement).value); }}
          className="border rounded px-3 py-1.5 flex-1 max-w-md"
        />
        <button onClick={() => refetch()} className="px-3 py-1.5 border rounded hover:bg-gray-50">
          Refresh
        </button>
        <span className="ml-auto text-xs text-gray-500">{total} user{total === 1 ? '' : 's'}</span>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="text-left py-3 px-4">Name</th>
              <th className="text-left">Email</th>
              <th className="text-left">Role</th>
              <th className="text-left">Status</th>
              <th className="text-left">Last Login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">Loading…</td>
              </tr>
            ) : data?.data.length ? (
              data.data.map((u) => (
                <tr key={u.id} className="border-t hover:bg-gray-50">
                  <td className="py-2 px-4 font-medium">{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${ROLE_BADGE[u.role] ?? 'bg-gray-100 text-gray-700'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        u.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                    {u.must_change_password && (
                      <span className="ml-1 text-xs text-amber-600">must change pw</span>
                    )}
                  </td>
                  <td className="text-gray-600">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                  </td>
                  <td className="text-right pr-4">
                    <Link
                      href={`/settings/users/${u.id}`}
                      className="text-blue-600 hover:underline text-sm"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="text-center py-8 text-gray-500">No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded border disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-gray-600">Page {page} of {totalPages}</span>
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded border disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
