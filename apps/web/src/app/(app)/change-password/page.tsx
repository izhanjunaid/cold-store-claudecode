'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { defaultRouteForRole } from '@/lib/auth-redirect';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';

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
    if (next !== confirm) return setError('New password and confirmation do not match');
    if (next.length < 8) return setError('New password must be at least 8 characters');
    setSubmitting(true);
    try {
      const updated = await apiClient<{ must_change_password: boolean }>('/v1/auth/change-password', {
        method: 'POST',
        body: { current_password: current, new_password: next },
      });
      if (user) {
        const accessToken = localStorage.getItem('access_token') || '';
        const refreshToken = localStorage.getItem('refresh_token') || '';
        setUser({ ...user, must_change_password: updated.must_change_password }, accessToken, refreshToken);
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
    <div className="max-w-md">
      <PageHeader title="Change Password" description={forced ? undefined : 'Update the password on your account.'} />
      {forced && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-amber-800">
          You must change your password before continuing.
        </div>
      )}
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">Minimum 8 characters.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>
            {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Saving…' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
