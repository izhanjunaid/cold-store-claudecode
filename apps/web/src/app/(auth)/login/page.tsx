'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Snowflake } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { apiClient } from '@/lib/api-client';
import { defaultRouteForRole } from '@/lib/auth-redirect';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; name: string; role: string; facility_id: string };
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);

  // Read query params via window.location: useSearchParams() would force a
  // Suspense boundary around this statically-rendered page in Next 14.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSessionExpired(params.get('expired') === '1');
    const next = params.get('next');
    // Same-origin paths only — never follow an absolute/protocol-relative URL.
    if (next && next.startsWith('/') && !next.startsWith('//')) setNextPath(next);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiClient<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        headers: { 'X-Facility-ID': '00000000-0000-0000-0000-000000000001' },
      });
      setUser(result.user, result.access_token, result.refresh_token);
      const mustChange = (result.user as { must_change_password?: boolean })
        .must_change_password;
      // Return to where the user was headed, unless a password change is forced.
      router.push(
        !mustChange && nextPath ? nextPath : defaultRouteForRole(result.user.role, mustChange),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Snowflake className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">ColdChain</h1>
            <p className="text-sm text-muted-foreground">Cold Storage Management Platform</p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {sessionExpired && !error && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  You were signed out. Please sign in again.
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="admin@coldchain.pk" autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs text-muted-foreground hover:text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="Enter your password" autoComplete="current-password" />
              </div>
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Signing in…' : 'Sign In'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
