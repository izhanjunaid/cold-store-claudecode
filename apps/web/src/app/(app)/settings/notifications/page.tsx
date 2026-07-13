'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api-client';
import type { FacilityResponseType } from '@coldchain/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/layout/page-header';
import { PageSkeleton } from '@/components/page-skeleton';

interface DigestResult {
  sent: boolean;
  reason?: string;
  had_content: boolean;
}

const SELECT_CLASS =
  'flex h-9 w-auto rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const fmtHour = (h: number) => {
  const period = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
};

export default function NotificationSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [digestHour, setDigestHour] = useState(8);
  const [emailConfigured, setEmailConfigured] = useState(false);

  useEffect(() => {
    apiClient<FacilityResponseType>('/v1/facilities/me')
      .then((f) => {
        setEnabled(f.settings.notifications.daily_digest_enabled);
        setDigestHour(f.settings.notifications.digest_hour);
        setEmailConfigured(f.settings.email.enabled && f.settings.email.smtp_password_set);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    try {
      await apiClient<FacilityResponseType>('/v1/facilities/me', {
        method: 'PATCH',
        body: { settings: { notifications: { daily_digest_enabled: enabled, digest_hour: digestHour } } },
      });
      toast.success('Notification settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendNow() {
    setSending(true);
    try {
      const result = await apiClient<DigestResult>('/v1/notifications/digest/send-now', { method: 'POST', body: {} });
      if (result.sent) toast.success('Digest sent to the administrator email');
      else toast.error(result.reason ?? 'Could not send the digest');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the digest');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <PageSkeleton />;
  if (error) return <p className="text-destructive">{error}</p>;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notifications"
        description="Automated email summaries for the facility administrator"
        actions={<Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>}
      />

      {!emailConfigured && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Email sending isn&apos;t configured yet. Set it up in{' '}
          <span className="font-medium">Settings → Email</span> before enabling the digest.
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-sm">Daily Digest</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            A once-a-day email to the administrator summarising overdue receivables, rooms near
            capacity, and lots that have been in storage too long.
          </p>

          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox checked={enabled} onCheckedChange={(c) => setEnabled(!!c)} />
            Send the daily digest
          </label>

          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Send at</Label>
              <select
                value={digestHour}
                onChange={(e) => setDigestHour(Number(e.target.value))}
                disabled={!enabled}
                className={SELECT_CLASS}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </select>
            </div>
            <p className="pb-2 text-xs text-muted-foreground">Facility local time.</p>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Settings'}</Button>
        <Button variant="outline" onClick={sendNow} disabled={sending || !emailConfigured}>
          {sending ? 'Sending…' : 'Send digest now'}
        </Button>
        {!emailConfigured && <span className="text-xs text-muted-foreground">Configure email first.</span>}
      </div>
    </div>
  );
}
