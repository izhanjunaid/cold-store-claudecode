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
  access_token?: string;
  refresh_token?: string;
  two_factor_bypassed?: boolean;
  user?: { id: string; email: string; name: string; role: string; facility_id: string };
  requires_2fa?: boolean;
  pending_token?: string;
  message?: string;
}

const FACILITY_HEADERS = { 'X-Facility-ID': '00000000-0000-0000-0000-000000000001' };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [nextPath, setNextPath] = useState<string | null>(null);
  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [pendingToken, setPendingToken] = useState('');
  const [twoFaMessage, setTwoFaMessage] = useState('');
  const [code, setCode] = useState('');
  const [bypassWarning, setBypassWarning] = useState(false);
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

  const completeLogin = (result: LoginResponse) => {
    if (!result.access_token || !result.refresh_token || !result.user) return;
    setUser(result.user, result.access_token, result.refresh_token);
    const mustChange = (result.user as { must_change_password?: boolean }).must_change_password;
    // Return to where the user was headed, unless a password change is forced.
    const target =
      !mustChange && nextPath ? nextPath : defaultRouteForRole(result.user.role, mustChange);
    if (result.two_factor_bypassed) {
      // 2FA is on but the code email could not be sent (offline / email
      // misconfigured). Let the user in, but say so before redirecting.
      setBypassWarning(true);
      setTimeout(() => router.push(target), 2500);
    } else {
      router.push(target);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiClient<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        headers: FACILITY_HEADERS,
      });
      if (result.requires_2fa && result.pending_token) {
        setPendingToken(result.pending_token);
        setTwoFaMessage(result.message ?? 'Enter the verification code from your email.');
        setStep('2fa');
        return;
      }
      completeLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await apiClient<LoginResponse>('/v1/auth/login/verify-2fa', {
        method: 'POST',
        body: { pending_token: pendingToken, code },
        headers: FACILITY_HEADERS,
      });
      completeLogin(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
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
            {bypassWarning && (
              <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Two-factor authentication is enabled but the code email could not be sent
                (email offline or not configured). Signing you in…
              </div>
            )}
            {step === 'credentials' ? (
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
            ) : (
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  {twoFaMessage}
                </div>
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="code">6-digit code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    required
                    autoFocus
                    placeholder="123456"
                    className="text-center font-mono text-lg tracking-[0.5em]"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button type="submit" disabled={loading || code.length !== 6} className="w-full">
                  {loading ? 'Verifying…' : 'Verify & Sign In'}
                </Button>
                <button
                  type="button"
                  onClick={() => { setStep('credentials'); setCode(''); setError(''); }}
                  className="w-full text-center text-xs text-muted-foreground hover:text-primary hover:underline"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
