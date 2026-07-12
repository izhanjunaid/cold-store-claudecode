'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import type { FacilityResponseType, TestEmailResponseType } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function EmailSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [fromName, setFromName] = useState('ColdChain');
  const [adminEmail, setAdminEmail] = useState('');

  useEffect(() => {
    apiClient<FacilityResponseType>('/v1/facilities/me')
      .then((f) => {
        const email = f.settings.email;
        setEnabled(email.enabled);
        setSmtpHost(email.smtp_host);
        setSmtpPort(String(email.smtp_port));
        setSmtpSecure(email.smtp_secure);
        setSmtpUser(email.smtp_user);
        setFromName(email.from_name);
        setAdminEmail(email.admin_email);
        setPasswordSet(email.smtp_password_set);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const updated = await apiClient<FacilityResponseType>('/v1/facilities/me', {
        method: 'PATCH',
        body: {
          settings: {
            email: {
              enabled,
              smtp_host: smtpHost.trim(),
              smtp_port: Math.max(1, Math.min(65535, Math.floor(Number(smtpPort) || 587))),
              smtp_secure: smtpSecure,
              smtp_user: smtpUser.trim(),
              from_name: fromName.trim() || 'ColdChain',
              admin_email: adminEmail.trim(),
              ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
            },
          },
        },
      });
      setPasswordSet(updated.settings.email.smtp_password_set);
      setSmtpPassword('');
      toast.success('Email settings saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const result = await apiClient<TestEmailResponseType>('/v1/facilities/me/test-email', {
        method: 'POST',
        body: {},
      });
      if (result.sent) toast.success(`Test email sent to ${adminEmail || 'the SMTP user'}`);
      else toast.error(result.error ?? 'Test email failed');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Test email failed');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Email"
        description="Outgoing email for password-reset codes, login verification and notifications"
        actions={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>}
      />

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle className="text-sm">SMTP Server (Gmail)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              For Gmail: keep the server defaults, enter your Gmail address, and use an{' '}
              <span className="font-medium">App Password</span> (Google Account → Security → 2-Step
              Verification → App passwords) — your normal Gmail password will not work. Requires the
              server to have internet access.
            </p>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(c) => setEnabled(!!c)} />
              Enable email sending
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="SMTP Host" className="md:col-span-2">
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Port">
                <Input type="number" min={1} max={65535} value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} className="tabular-nums" />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={smtpSecure} onCheckedChange={(c) => setSmtpSecure(!!c)} />
              Use SSL/TLS from the start (port 465). Leave off for STARTTLS on port 587 (Gmail default).
            </label>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Gmail Address / SMTP User">
                <Input type="email" value={smtpUser} placeholder="yourname@gmail.com" onChange={(e) => setSmtpUser(e.target.value)} />
              </Field>
              <Field label="App Password" hint={passwordSet && !smtpPassword ? 'A password is saved. Leave blank to keep it.' : '16-character Google App Password.'}>
                <Input
                  type="password"
                  value={smtpPassword}
                  placeholder={passwordSet ? '••••••••••••••••' : ''}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Sender & Administrator</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="From Name" hint="Shown as the sender name on outgoing emails.">
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </Field>
            <Field label="Administrator Email" hint="Receives test emails, daily digests and system notifications.">
              <Input type="email" value={adminEmail} placeholder="owner@gmail.com" onChange={(e) => setAdminEmail(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>
          <Button variant="outline" onClick={sendTest} disabled={testing || !enabled}>
            {testing ? 'Sending…' : 'Send Test Email'}
          </Button>
          {!enabled && <span className="text-xs text-muted-foreground">Enable and save first to send a test.</span>}
        </div>
      </div>
    </div>
  );
}
