'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FileText, Truck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';
import { formatDate } from '@/lib/format';

import { PageSkeleton } from '@/components/page-skeleton';
const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface OutboundEvent {
  id: string;
  lot_id: string;
  lot_number: string;
  withdrawal_type: 'FULL' | 'PARTIAL';
  quantity_withdrawn_bags: number;
  outbound_weight_kg: number | null;
  outbound_date: string;
  receiving_party_name: string | null;
  vehicle_number: string | null;
  dispatch_note_number: string | null;
  status: 'PENDING' | 'WEIGHED' | 'DISPATCHED' | 'CANCELLED' | 'DISPUTED';
  notes: string | null;
  prorated_inbound_weight_kg: number | null;
  weight_variance_pct: number | null;
  created_by_name: string;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

export default function OutboundEventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const confirm = useConfirm();
  const eventId = params['id'] as string;

  const [event, setEvent] = useState<OutboundEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [savingWeight, setSavingWeight] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvent(await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRecordWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    const kg = Number(weightInput);
    if (!kg || kg <= 0) return setError('Enter a valid weight');
    setSavingWeight(true);
    setError(null);
    try {
      setEvent(
        await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}/weight`, {
          method: 'PATCH',
          body: { outbound_weight_kg: kg },
        }),
      );
      toast.success('Weight recorded');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record weight');
    } finally {
      setSavingWeight(false);
    }
  };

  const handleFinalize = async () => {
    const ok = await confirm({
      title: 'Finalize & dispatch?',
      description: 'Lot balance will be updated and a dispatch note generated. This cannot be undone.',
      confirmText: 'Confirm',
    });
    if (!ok) return;
    setFinalizing(true);
    setError(null);
    try {
      setEvent(await apiClient<OutboundEvent>(`/v1/outbound-events/${eventId}/finalize`, { method: 'POST', body: {} }));
      toast.success('Dispatch finalized. Lot balance updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Finalize failed');
    } finally {
      setFinalizing(false);
    }
  };

  const handlePrintDispatchNote = async () => {
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/outbound-events/${eventId}/dispatch-note`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to fetch dispatch note');
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load dispatch note');
    }
  };

  if (loading) return <PageSkeleton />;
  if (error && !event) return <p className="text-destructive">{error}</p>;
  if (!event) return <p className="text-destructive">Not found.</p>;

  const isActionable = event.status !== 'DISPATCHED' && event.status !== 'CANCELLED';

  return (
    <div className="max-w-2xl">
      <PageHeader title={event.dispatch_note_number ?? 'Withdrawal'} crumb="Dispatch" />

      <div className="mb-4 flex items-center gap-2 text-sm">
        <StatusBadge status={event.status} />
        <span className="text-muted-foreground">Lot:</span>
        <Button
          variant="link"
          className="h-auto p-0 font-mono"
          onClick={() => router.push(`/lots/${event.lot_id}`)}
        >
          {event.lot_number}
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-sm">Dispatch Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label="Withdrawal Type" value={event.withdrawal_type} />
          <Field label="Bags Withdrawn" value={event.quantity_withdrawn_bags.toLocaleString()} />
          <Field label="Outbound Date" value={formatDate(event.outbound_date)} />
          <Field label="Operator" value={event.created_by_name} />
          {event.receiving_party_name && <Field label="Receiving Party" value={event.receiving_party_name} />}
          {event.vehicle_number && <Field label="Vehicle" value={event.vehicle_number} />}
          {event.notes && (
            <div className="col-span-2">
              <Field label="Notes" value={event.notes} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle className="text-sm">Weight</CardTitle>
        </CardHeader>
        <CardContent>
          {event.status === 'PENDING' && (
            <form onSubmit={handleRecordWeight} className="flex items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label>Outbound Weight (kg) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  placeholder="e.g. 4850.00"
                  className="tabular-nums"
                  required
                />
              </div>
              <Button type="submit" disabled={savingWeight}>
                {savingWeight ? 'Saving…' : 'Record Weight'}
              </Button>
            </form>
          )}

          {event.outbound_weight_kg != null && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Field label="Outbound Weight" value={`${event.outbound_weight_kg.toLocaleString()} kg`} />
              {event.prorated_inbound_weight_kg != null && (
                <Field label="Prorated Inbound" value={`${event.prorated_inbound_weight_kg.toLocaleString()} kg`} />
              )}
              {event.weight_variance_pct != null && (
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Variance</div>
                  <div className={`mt-0.5 font-semibold ${Math.abs(event.weight_variance_pct) > 5 ? 'text-destructive' : 'text-foreground'}`}>
                    {event.weight_variance_pct > 0 ? '+' : ''}
                    {event.weight_variance_pct.toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
          )}

          {event.status === 'PENDING' && event.outbound_weight_kg == null && (
            <p className="mt-2 text-xs text-muted-foreground">Weight not yet recorded.</p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        {isActionable && event.status === 'WEIGHED' && (
          <Button onClick={handleFinalize} disabled={finalizing}>
            <Truck className="h-4 w-4" aria-hidden />
            {finalizing ? 'Finalizing…' : 'Finalize & Dispatch'}
          </Button>
        )}
        <Button variant="outline" onClick={handlePrintDispatchNote}>
          <FileText className="h-4 w-4" aria-hidden />
          Print Dispatch Note
        </Button>
      </div>
    </div>
  );
}
