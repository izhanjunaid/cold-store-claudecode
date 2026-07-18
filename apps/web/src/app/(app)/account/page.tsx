'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck, ShieldOff, Smartphone, Mail, Monitor, LogOut, Copy } from 'lucide-react';
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
  two_factor_method: 'totp' | 'email' | null;
  backup_codes_remaining: number | null;
}

export default function AccountPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => apiClient<Me>('/v1/auth/me'),
  });

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

        <TwoFactorCard me={me} onChanged={() => queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })} />

        <SessionsCard />
      </div>
    </div>
  );
}

// ─── Two-factor authentication ─────────────────────────────────────────────

function TwoFactorCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  // TOTP enrollment
  const [totpStep, setTotpStep] = useState<'idle' | 'qr'>('idle');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  // One-time backup-codes reveal (after enable or regenerate)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  // Email 2FA enrollment
  const [emailStep, setEmailStep] = useState<'idle' | 'code'>('idle');
  const [emailCode, setEmailCode] = useState('');
  // Password confirmations
  const [confirmAction, setConfirmAction] = useState<'disable-totp' | 'disable-email' | 'regen' | null>(null);
  const [confirmPassword, setConfirmPassword] = useState('');

  async function run<T>(fn: () => Promise<T>, onOk?: (result: T) => void) {
    setBusy(true);
    try {
      const result = await fn();
      onOk?.(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const startTotpSetup = () =>
    run(
      () => apiClient<{ otpauth_uri: string; secret: string }>('/v1/auth/2fa/totp/setup', { method: 'POST', body: {} }),
      (r) => {
        setOtpauthUri(r.otpauth_uri);
        setTotpSecret(r.secret);
        setTotpStep('qr');
      },
    );

  const confirmTotpEnable = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () => apiClient<{ backup_codes: string[] }>('/v1/auth/2fa/totp/enable', { method: 'POST', body: { code: totpCode } }),
      (r) => {
        toast.success('Authenticator app 2FA enabled');
        setBackupCodes(r.backup_codes);
        setTotpStep('idle');
        setTotpCode('');
        onChanged();
      },
    );
  };

  const submitConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const password = confirmPassword;
    if (confirmAction === 'disable-totp') {
      void run(
        () => apiClient('/v1/auth/2fa/totp/disable', { method: 'POST', body: { password } }),
        () => {
          toast.success('Two-factor authentication disabled');
          resetConfirm();
          setBackupCodes(null);
          onChanged();
        },
      );
    } else if (confirmAction === 'disable-email') {
      void run(
        () => apiClient('/v1/auth/2fa/disable', { method: 'POST', body: { password } }),
        () => {
          toast.success('Two-factor authentication disabled');
          resetConfirm();
          onChanged();
        },
      );
    } else if (confirmAction === 'regen') {
      void run(
        () => apiClient<{ backup_codes: string[] }>('/v1/auth/2fa/backup-codes/regenerate', { method: 'POST', body: { password } }),
        (r) => {
          toast.success('New backup codes generated — the old ones no longer work');
          setBackupCodes(r.backup_codes);
          resetConfirm();
          onChanged();
        },
      );
    }
  };

  function resetConfirm() {
    setConfirmAction(null);
    setConfirmPassword('');
  }

  const startEmailEnable = () =>
    run(
      () => apiClient<{ message: string }>('/v1/auth/2fa/request-enable', { method: 'POST', body: {} }),
      (r) => {
        toast.success(r.message);
        setEmailStep('code');
      },
    );

  const confirmEmailEnable = (e: React.FormEvent) => {
    e.preventDefault();
    void run(
      () => apiClient('/v1/auth/2fa/enable', { method: 'POST', body: { code: emailCode } }),
      () => {
        toast.success('Email 2FA enabled');
        setEmailStep('idle');
        setEmailCode('');
        onChanged();
      },
    );
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Two-Factor Authentication</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {me.two_factor_method === 'totp' ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
              <span>
                Enabled via authenticator app — codes work fully offline.{' '}
                <span className="text-muted-foreground">
                  {me.backup_codes_remaining ?? 0} of 8 backup codes remaining.
                </span>
              </span>
            </div>
            {confirmAction === null && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setConfirmAction('regen')}>
                  Regenerate backup codes
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmAction('disable-totp')}>
                  Disable 2FA
                </Button>
              </div>
            )}
          </>
        ) : me.two_factor_method === 'email' ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
              <span>Enabled — signing in requires a code emailed to {me.email}.</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Email codes need working email settings and internet at sign-in time; if the server
              cannot send the email, login proceeds with a warning. For stronger, fully offline
              protection switch to the authenticator app below.
            </p>
            {confirmAction === null && (
              <div className="flex gap-2">
                <Button size="sm" onClick={startTotpSetup} disabled={busy || totpStep === 'qr'}>
                  <Smartphone className="mr-2 h-4 w-4" aria-hidden />
                  Switch to authenticator app
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmAction('disable-email')}>
                  Disable 2FA
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span>Disabled — your account is protected by password only.</span>
            </div>
            {totpStep === 'idle' && emailStep === 'idle' && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">Authenticator app (recommended)</p>
                    <p className="text-xs text-muted-foreground">
                      Google Authenticator, Microsoft Authenticator, or any TOTP app. Works fully
                      offline — no email or internet needed to sign in.
                    </p>
                    <Button size="sm" onClick={startTotpSetup} disabled={busy}>
                      {busy ? 'Preparing…' : 'Set up authenticator app'}
                    </Button>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-md border p-3">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="flex-1 space-y-1">
                    <p className="text-sm font-medium">Email codes</p>
                    <p className="text-xs text-muted-foreground">
                      A code is emailed at sign-in. Requires working email settings; if the server
                      is offline, login falls back to password-only with a warning.
                    </p>
                    <Button size="sm" variant="outline" onClick={startEmailEnable} disabled={busy}>
                      {busy ? 'Sending code…' : 'Enable email codes'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {totpStep === 'qr' && (
          <TotpEnrollPanel
            otpauthUri={otpauthUri}
            secret={totpSecret}
            code={totpCode}
            setCode={setTotpCode}
            busy={busy}
            onSubmit={confirmTotpEnable}
            onCancel={() => { setTotpStep('idle'); setTotpCode(''); }}
          />
        )}

        {emailStep === 'code' && (
          <form onSubmit={confirmEmailEnable} className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="enable-code">6-digit code from your email</Label>
              <Input
                id="enable-code"
                inputMode="numeric"
                maxLength={6}
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))}
                placeholder="123456"
                className="w-40 text-center font-mono tracking-[0.3em]"
                autoComplete="one-time-code"
              />
            </div>
            <Button type="submit" size="sm" disabled={busy || emailCode.length !== 6}>Confirm</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEmailStep('idle'); setEmailCode(''); }}>
              Cancel
            </Button>
          </form>
        )}

        {confirmAction !== null && (
          <form onSubmit={submitConfirm} className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">
                {confirmAction === 'regen' ? 'Confirm your password to regenerate' : 'Confirm your password'}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-56"
                autoComplete="current-password"
                autoFocus
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant={confirmAction === 'regen' ? 'default' : 'destructive'}
              disabled={busy || confirmPassword.length < 8}
            >
              {confirmAction === 'regen' ? 'Regenerate' : 'Disable'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={resetConfirm}>Cancel</Button>
          </form>
        )}

        {backupCodes && (
          <BackupCodesPanel codes={backupCodes} onDismiss={() => setBackupCodes(null)} />
        )}
      </CardContent>
    </Card>
  );
}

function TotpEnrollPanel({
  otpauthUri,
  secret,
  code,
  setCode,
  busy,
  onSubmit,
  onCancel,
}: {
  otpauthUri: string;
  secret: string;
  code: string;
  setCode: (value: string) => void;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUri, { margin: 1, width: 192 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { /* manual-entry fallback below always works */ });
    return () => { cancelled = true; };
  }, [otpauthUri]);

  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="text-sm font-medium">Scan this QR code with your authenticator app</p>
      {qrDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qrDataUrl} alt="TOTP enrollment QR code" className="h-48 w-48 rounded bg-white p-1" />
      ) : (
        <p className="text-xs text-muted-foreground">Generating QR code…</p>
      )}
      <p className="text-xs text-muted-foreground">
        Can&apos;t scan? Enter this key manually:{' '}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{secret}</code>
      </p>
      <form onSubmit={onSubmit} className="flex items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="totp-code">6-digit code from the app</Label>
          <Input
            id="totp-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            className="w-40 text-center font-mono tracking-[0.3em]"
            autoComplete="one-time-code"
            autoFocus
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || code.length !== 6}>Verify & Enable</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </form>
    </div>
  );
}

function BackupCodesPanel({ codes, onDismiss }: { codes: string[]; onDismiss: () => void }) {
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast.success('Backup codes copied');
    } catch {
      toast.error('Could not copy — select and copy the codes manually');
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">
        Save these backup codes now — they will not be shown again.
      </p>
      <p className="text-xs text-amber-800">
        Each code signs you in once if your phone is lost or unavailable. Keep them somewhere safe
        (printed and locked away beats a sticky note on the monitor).
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-amber-950 sm:grid-cols-4">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={copyAll}>
          <Copy className="mr-2 h-4 w-4" aria-hidden />
          Copy all
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>I saved them</Button>
      </div>
    </div>
  );
}

// ─── Sessions ──────────────────────────────────────────────────────────────

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
