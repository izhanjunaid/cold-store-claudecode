'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { KeyRound, ShieldCheck, ShieldOff, Monitor, LogOut } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';
import { describeUserAgent } from '@/lib/user-agent';

interface Me {
  id: string;
  email: string;
  name: string;
  name_urdu: string | null;
  role: string;
  two_factor_enabled: boolean;
}

export default function AccountPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient<Me>('/v1/auth/me'),
  });

  const [enableStep, setEnableStep] = useState<'idle' | 'code'>('idle');
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });

  async function startEnable() {
    setBusy(true);
    try {
      const result = await apiClient<{ message: string }>('/v1/auth/2fa/request-enable', { method: 'POST', body: {} });
      toast.success(result.message);
      setEnableStep('code');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient('/v1/auth/2fa/enable', { method: 'POST', body: { code } });
      toast.success('Two-factor authentication enabled');
      setEnableStep('idle');
      setCode('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiClient('/v1/auth/2fa/disable', { method: 'POST', body: { password: disablePassword } });
      toast.success('Two-factor authentication disabled');
      setShowDisable(false);
      setDisablePassword('');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Wrong password');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !me) return <PageSkeleton />;

  return (
    <div className="max-w-3xl">
      <PageHeader title="My Account" description="Your profile and sign-in security" />

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-sm">Profile</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{me.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{me.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <Badge variant="secondary">{me.role}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Password</CardTitle></CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/change-password">
                <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                Change password
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Two-Factor Authentication</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2 text-sm">
              {me.two_factor_enabled ? (
                <>
                  <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                  <span>Enabled — signing in requires a code emailed to {me.email}.</span>
                </>
              ) : (
                <>
                  <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <span>Disabled — your account is protected by password only.</span>
                </>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Requires working email settings (Settings → Email). If the server cannot send email
              at sign-in time, login proceeds with a warning instead of locking you out.
            </p>

            {!me.two_factor_enabled && enableStep === 'idle' && (
              <Button size="sm" onClick={startEnable} disabled={busy}>
                {busy ? 'Sending code…' : 'Enable 2FA'}
              </Button>
            )}

            {!me.two_factor_enabled && enableStep === 'code' && (
              <form onSubmit={confirmEnable} className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="enable-code">6-digit code from your email</Label>
                  <Input
                    id="enable-code"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-40 text-center font-mono tracking-[0.3em]"
                    autoComplete="one-time-code"
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy || code.length !== 6}>Confirm</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setEnableStep('idle'); setCode(''); }}>
                  Cancel
                </Button>
              </form>
            )}

            {me.two_factor_enabled && !showDisable && (
              <Button size="sm" variant="outline" onClick={() => setShowDisable(true)}>Disable 2FA</Button>
            )}

            {me.two_factor_enabled && showDisable && (
              <form onSubmit={confirmDisable} className="flex items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="disable-password">Confirm your password</Label>
                  <Input
                    id="disable-password"
                    type="password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    className="w-56"
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" size="sm" variant="destructive" disabled={busy || disablePassword.length < 8}>
                  Disable
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setShowDisable(false); setDisablePassword(''); }}>
                  Cancel
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <SessionsCard />
      </div>
    </div>
  );
}

interface Session {
  id: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
}

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function SessionsCard() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => apiClient<{ sessions: Session[] }>('/v1/auth/sessions'),
  });

  const sessions = data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });

  async function revoke(id: string) {
    setBusy(true);
    try {
      await apiClient(`/v1/auth/sessions/${id}`, { method: 'DELETE' });
      toast.success('Signed out that device');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not sign out that device');
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      await apiClient('/v1/auth/sessions/revoke-others', { method: 'POST', body: {} });
      toast.success('Signed out all other devices');
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not sign out other devices');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">Active Sessions</CardTitle>
        {others > 0 && (
          <Button size="sm" variant="outline" onClick={revokeOthers} disabled={busy}>
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            Sign out other devices
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading sessions…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions.</p>
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{describeUserAgent(s.user_agent)}</span>
                    {s.current && <Badge variant="secondary" className="text-[10px]">This device</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.ip ?? 'Unknown IP'} · Last active {fmtWhen(s.last_used_at ?? s.created_at)}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => revoke(s.id)} disabled={busy}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
