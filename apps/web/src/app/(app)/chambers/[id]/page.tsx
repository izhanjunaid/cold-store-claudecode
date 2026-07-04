'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/layout/page-header';
import { cn } from '@/lib/utils';

import { formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
interface TemperatureLog {
  id: string;
  temperature_c: number;
  recorded_at: string;
  recorded_by_name?: string;
  source: string;
}
interface ChamberDetail {
  id: string;
  name: string;
  commodity_restriction_name: string | null;
  max_capacity_bags: number;
  current_occupancy_bags: number;
  temperature_min_c: number | null;
  temperature_max_c: number | null;
  is_active: boolean;
  notes: string | null;
  temperature_logs: TemperatureLog[];
}

export default function ChamberDetailPage() {
  const params = useParams();
  const chamberId = params['id'] as string;
  const [chamber, setChamber] = useState<ChamberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tempInput, setTempInput] = useState('');
  const [loggingTemp, setLoggingTemp] = useState(false);

  const fetchChamber = useCallback(() => {
    apiClient<ChamberDetail>(`/v1/chambers/${chamberId}`).then(setChamber).catch(() => {}).finally(() => setLoading(false));
  }, [chamberId]);

  useEffect(() => {
    fetchChamber();
  }, [fetchChamber]);

  const handleLogTemp = async () => {
    if (!tempInput) return;
    setLoggingTemp(true);
    try {
      await apiClient(`/v1/chambers/${chamberId}/temperature`, {
        method: 'POST',
        body: { temperature_c: parseFloat(tempInput), source: 'MANUAL' },
      });
      setTempInput('');
      fetchChamber();
    } catch {
      /* handled */
    } finally {
      setLoggingTemp(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!chamber) return <p className="text-destructive">Chamber not found</p>;

  const pct = Math.round((chamber.current_occupancy_bags / chamber.max_capacity_bags) * 100);

  return (
    <div>
      <PageHeader title={chamber.name} crumb={chamber.name} />

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Chamber Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Commodity</dt><dd className="font-medium">{chamber.commodity_restriction_name || 'Multi-commodity'}</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Capacity</dt><dd className="font-medium tabular-nums">{chamber.max_capacity_bags.toLocaleString()} bags</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Temp Range</dt><dd className="font-medium">{chamber.temperature_min_c ?? '?'}°C – {chamber.temperature_max_c ?? '?'}°C</dd></div>
              <div className="flex justify-between py-1.5"><dt className="text-muted-foreground">Status</dt><dd><StatusBadge status={chamber.is_active ? 'ACTIVE' : 'INACTIVE'} /></dd></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 text-center">
              <span className="text-4xl font-bold tabular-nums">{pct}%</span>
              <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                {chamber.current_occupancy_bags.toLocaleString()} / {chamber.max_capacity_bags.toLocaleString()} bags
              </p>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-3 rounded-full', pct > 90 ? 'bg-destructive' : pct > 75 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">Temperature History</CardTitle>
          <div className="flex items-center gap-2">
            <Input type="number" step={0.1} placeholder="Temp °C" value={tempInput} onChange={(e) => setTempInput(e.target.value)} className="h-8 w-28 tabular-nums" />
            <Button size="sm" onClick={handleLogTemp} disabled={loggingTemp || !tempInput}>
              {loggingTemp ? 'Logging…' : 'Log Temp'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {chamber.temperature_logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No temperature readings recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Temperature</TableHead>
                  <TableHead>Recorded By</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chamber.temperature_logs.map((log) => {
                  const inRange =
                    chamber.temperature_min_c !== null && chamber.temperature_max_c !== null
                      ? log.temperature_c >= chamber.temperature_min_c && log.temperature_c <= chamber.temperature_max_c
                      : true;
                  return (
                    <TableRow key={log.id}>
                      <TableCell>{formatDateTime(log.recorded_at)}</TableCell>
                      <TableCell className={cn('font-medium tabular-nums', inRange ? 'text-green-700' : 'text-destructive')}>{log.temperature_c}°C</TableCell>
                      <TableCell>{log.recorded_by_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{log.source}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {chamber.notes && (
        <Card className="mt-6">
          <CardHeader><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
          <CardContent><p className="text-sm">{chamber.notes}</p></CardContent>
        </Card>
      )}
    </div>
  );
}
