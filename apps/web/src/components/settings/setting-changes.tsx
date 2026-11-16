'use client';

import { useState } from 'react';
import type { SettingVersionType } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/** The Settings screen's own words for each stored setting. */
const LABEL: Record<string, string> = {
  weight_dispute_threshold_kg: 'Weight dispute threshold (kg)',
  storage_alert_thresholds: 'Storage alert days per commodity',
  gst_registered: 'Sales tax on bills',
  gst_default_rate: 'Sales tax rate (%)',
  number_format: 'Number format',
  chamber_capacity_warning_pct: 'Room capacity warning (%)',
  backdating_max_days: 'Backdating limit (days)',
  fiscal_year_start_month: 'Fiscal year start month',
  late_payment_surcharge: 'Late payment surcharge',
  revenue_accrual: 'Monthly revenue accrual',
  payroll: 'Payroll rules',
  cash_tracking_from: 'Cash tracking from',
  dispatch_solo_mode: 'Munshi may dispatch alone',
  hide_weights: 'Weights hidden',
  book_only_trucks_inside: 'Book only trucks inside the gate',
};

function show(value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${show(v)}`)
      .join(', ') || 'none';
  }
  return String(value);
}

function Rows({ rows }: { rows: SettingVersionType[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Setting</TableHead>
          <TableHead>Value</TableHead>
          <TableHead>From</TableHead>
          <TableHead>Saved by</TableHead>
          <TableHead>Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell>{LABEL[r.key] ?? r.key}</TableCell>
            <TableCell>{show(r.value)}</TableCell>
            <TableCell>{r.is_baseline ? 'before' : r.effective_from}</TableCell>
            <TableCell>{r.saved_by_name ?? '—'}</TableCell>
            <TableCell>{r.note ?? ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Changes saved for a day still ahead, and (on request) every change ever saved. */
export function SettingChanges({ pending }: { pending: SettingVersionType[] }) {
  const [history, setHistory] = useState<SettingVersionType[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setHistory(await apiClient<SettingVersionType[]>('/v1/facilities/me/settings/history'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {pending.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Changes that have not started yet</CardTitle></CardHeader>
          <CardContent>
            <p className="pb-2 text-xs text-muted-foreground">
              These are saved and will start on their date. The values above are what is in force today.
            </p>
            <Rows rows={pending} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-sm">History of changes</CardTitle></CardHeader>
        <CardContent>
          {history === null ? (
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? 'Loading…' : 'Show history'}
            </Button>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No setting has been changed yet.</p>
          ) : (
            <Rows rows={history} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
