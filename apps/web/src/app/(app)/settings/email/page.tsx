'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import type { FacilityResponseType, TestEmailResponseType, EmailProviderType } from '@coldchain/shared';
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

function ProviderOption({
  selected,
  onSelect,
  title,
  badge,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  badge?: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex-1 rounded-md border p-3 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:border-muted-foreground/40'
      }`}
    >
      <p className="text-sm font-medium">
        {title}
        {badge && (
          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {badge}
          </span>
        )}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

export default function EmailSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<EmailProviderType>('BREVO');
  // Brevo
  const [fromEmail, setFromEmail] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  // SMTP (legacy)
  const [smtpHost, setSmtpHost] = useState('smtp.gmail.com');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  // Common
  const [fromName, setFromName] = useState('ColdChain');
  const [adminEmail, setAdminEmail] = useState('');

  useEffect(() => {
    apiClient<FacilityResponseType>('/v1/facilities/me')
      .then((f) => {
        const email = f.settings.email;
        setEnabled(email.enabled);
        // Existing SMTP setups keep showing SMTP; fresh facilities default to Brevo.
        setProvider(email.provider === 'SMTP' && !email.smtp_password_set && !email.enabled ? 'BREVO' : email.provider);
        setFromEmail(email.from_email);
        setApiKeySet(email.api_key_set);
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
              provider,
              smtp_host: smtpHost.trim() || 'smtp.gmail.com',
              smtp_port: Math.max(1, Math.min(65535, Math.floor(Number(smtpPort) || 587))),
              smtp_secure: smtpSecure,
              smtp_user: smtpUser.trim(),
              from_email: fromEmail.trim(),
              from_name: fromName.trim() || 'ColdChain',
              admin_email: adminEmail.trim(),
              ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
              ...(apiKey ? { api_key: apiKey.trim() } : {}),
            },
          },
        },
      });
      setPasswordSet(updated.settings.email.smtp_password_set);
      setApiKeySet(updated.settings.email.api_key_set);
      setSmtpPassword('');
      setApiKey('');
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
      if (result.sent) toast.success(`Test email sent to ${adminEmail || 'the sender address'}`);
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
          <CardHeader><CardTitle className="text-sm">Email Provider</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={enabled} onCheckedChange={(c) => setEnabled(!!c)} />
              Enable email sending
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <ProviderOption
                selected={provider === 'BREVO'}
                onSelect={() => setProvider('BREVO')}
                title="Brevo"
                badge="Recommended"
                description="Free email API (300 emails/day). Only needs a verified sender address — no domain, no Google account. Sign up at brevo.com, verify your sender email, paste the API key below."
              />
              <ProviderOption
                selected={provider === 'SMTP'}
                onSelect={() => setProvider('SMTP')}
                title="SMTP / Gmail"
                badge="Legacy"
                description="Any SMTP server, including Gmail with an App Password. Still supported, but Google considers app passwords legacy — Brevo is the easier path."
              />
            </div>
          </CardContent>
        </Card>

        {provider === 'BREVO' ? (
          <Card>
            <CardHeader><CardTitle className="text-sm">Brevo Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Create a free account at <span className="font-medium">brevo.com</span> → verify your
                sender email address (Settings → Senders) → create an API key (Settings → API Keys)
                and paste it here. Sending requires the server to have internet access.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Verified Sender Email" hint="Must match a verified sender in your Brevo account.">
                  <Input type="email" value={fromEmail} placeholder="owner@example.com" onChange={(e) => setFromEmail(e.target.value)} />
                </Field>
                <Field label="API Key" hint={apiKeySet && !apiKey ? 'A key is saved. Leave blank to keep it.' : 'Starts with “xkeysib-”.'}>
                  <Input
                    type="password"
                    value={apiKey}
                    placeholder={apiKeySet ? '••••••••••••••••' : 'xkeysib-…'}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle className="text-sm">SMTP Server (Gmail)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                For Gmail: keep the server defaults, enter your Gmail address, and use an{' '}
                <span className="font-medium">App Password</span> (Google Account → Security → 2-Step
                Verification → App passwords) — your normal Gmail password will not work. Requires the
                server to have internet access.
              </p>
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
        )}

        <Card>
          <CardHeader><CardTitle className="text-sm">Sender & Administrator</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="From Name" hint="Shown as the sender name on outgoing emails.">
              <Input value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </Field>
            <Field label="Administrator Email" hint="Receives test emails, daily digests and system notifications.">
              <Input type="email" value={adminEmail} placeholder="owner@example.com" onChange={(e) => setAdminEmail(e.target.value)} />
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
