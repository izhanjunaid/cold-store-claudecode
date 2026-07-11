'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, FileText, PackageMinus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';
import { UrduText } from '@/components/ui/urdu-text';
import { PageHeader } from '@/components/layout/page-header';
import { LotLocationCard, LotMovementsTimeline } from '@/components/lot-location';

import { formatDate, formatDateTime } from '@/lib/format';
import { PageSkeleton } from '@/components/page-skeleton';
const API_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001';

interface Lot {
  id: string;
  lot_number: string;
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED';
  owner_party_id: string;
  owner_party_name: string | null;
  billing_party_id: string;
  billing_party_name: string | null;
  commodity_name: string | null;
  variety_name: string | null;
  chamber_name: string | null;
  rate_plan_name: string | null;
  quantity_bags: number;
  current_balance_bags: number;
  accepted_weight_kg: number;
  declared_weight_kg: number | null;
  weight_dispute_flag: boolean;
  weight_dispute_note: string | null;
  quality_grade_inbound: string | null;
  inbound_date: string;
  entry_date: string;
  vehicle_number: string | null;
  marka: string | null;
  book_type: string;
  notes: string | null;
  days_in_storage: number;
  closed_at: string | null;
  created_at: string;
}
interface OwnershipEvent {
  id: string;
  event_type: string;
  from_party_name: string | null;
  to_party_name: string | null;
  quantity_bags: number;
  transfer_price_pkr: number | null;
  effective_date: string;
  operator_name: string | null;
}
interface OutboundSummary {
  id: string;
  dispatch_note_number: string | null;
  withdrawal_type: string;
  quantity_withdrawn_bags: number;
  status: string;
  outbound_date: string;
}
interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  total_pkr: number;
  status: string;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  INITIAL: 'Initial Inbound',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
};

function Field({ label, value, urdu }: { label: string; value: React.ReactNode; urdu?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={urdu ? 'mt-1' : 'mt-1 text-sm font-medium text-foreground'}>{value}</p>
    </div>
  );
}

export default function LotDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params['id'] as string;
  const recentTransferId = searchParams?.get('transfer');

  const [lot, setLot] = useState<Lot | null>(null);
  const [ownershipHistory, setOwnershipHistory] = useState<OwnershipEvent[]>([]);
  const [outboundEvents, setOutboundEvents] = useState<OutboundSummary[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(recentTransferId ? 'ownership' : 'overview');
  const [receiptLoading, setReceiptLoading] = useState(false);
  const user = useAuthStore((s) => s.user);
  const canTransfer = user?.role === 'OWNER' || user?.role === 'MANAGER';
  const canWithdraw =
    user?.role != null && ['OWNER', 'MANAGER', 'ACCOUNTANT', 'OPERATOR'].includes(user.role);

  const fetchLot = useCallback(async () => {
    setLoading(true);
    try {
      setLot(await apiClient<Lot>(`/v1/lots/${id}`));
    } catch {
      /* handled */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchLot();
  }, [fetchLot]);

  useEffect(() => {
    if (activeTab === 'ownership' && ownershipHistory.length === 0)
      apiClient<OwnershipEvent[]>(`/v1/lots/${id}/ownership-history`).then(setOwnershipHistory).catch(() => {});
    if (activeTab === 'withdrawals' && outboundEvents.length === 0)
      apiClient<OutboundSummary[]>(`/v1/lots/${id}/outbound-events`).then(setOutboundEvents).catch(() => {});
    if (activeTab === 'billing' && invoices.length === 0)
      apiClient<InvoiceSummary[]>(`/v1/lots/${id}/invoices`).then(setInvoices).catch(() => {});
  }, [activeTab, id, ownershipHistory.length, outboundEvents.length, invoices.length]);

  const handlePrintReceipt = async () => {
    setReceiptLoading(true);
    try {
      const token = localStorage.getItem('access_token');
      const facilityId = localStorage.getItem('facility_id');
      const res = await fetch(`${API_URL}/v1/lots/${id}/receipt`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(facilityId ? { 'X-Facility-ID': facilityId } : {}),
        },
      });
      if (!res.ok) throw new Error('Failed to fetch receipt');
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      /* handled */
    } finally {
      setReceiptLoading(false);
    }
  };

  if (loading) return <PageSkeleton />;
  if (!lot)
    return (
      <div>
        <p className="mb-4 text-destructive">Lot not found.</p>
        <Button variant="outline" onClick={() => router.push('/lots')}>
          Back to Lots
        </Button>
      </div>
    );

  const canAct = lot.status === 'ACTIVE' && lot.current_balance_bags > 0;

  return (
    <div>
      <PageHeader
        title={lot.lot_number}
        crumb={lot.lot_number}
        actions={
          <>
            {canTransfer && canAct && (
              <Button variant="outline" onClick={() => router.push(`/lots/${id}/transfer/new`)}>
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
                Transfer Ownership
              </Button>
            )}
            {canWithdraw && canAct && (
              <Button onClick={() => router.push(`/lots/${id}/withdraw`)}>
                <PackageMinus className="h-4 w-4" aria-hidden />
                New Withdrawal
              </Button>
            )}
            <Button variant="outline" onClick={handlePrintReceipt} disabled={receiptLoading}>
              <FileText className="h-4 w-4" aria-hidden />
              {receiptLoading ? 'Preparing…' : 'Print Receipt'}
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <StatusBadge status={lot.status} />
        <StatusBadge status={lot.book_type} tone="info" />
      </div>

      {recentTransferId && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800">Transfer completed successfully.</p>
          <Button
            variant="link"
            className="h-auto p-0 text-green-800"
            onClick={() => router.push(`/lots/${id}/transfer/${recentTransferId}/acknowledgment`)}
          >
            View / Print Acknowledgment
          </Button>
        </div>
      )}

      <Card className="mb-6">
        <CardContent className="pt-6">
          {lot.weight_dispute_flag && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-sm font-medium text-amber-800">Weight dispute flag</p>
              {lot.weight_dispute_note && <p className="mt-1 text-xs text-amber-700">{lot.weight_dispute_note}</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
            <Field
              label="Owner"
              value={
                <>
                  {lot.owner_party_name ?? '—'}
                  {lot.billing_party_id !== lot.owner_party_id && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      Billed to: {lot.billing_party_name}
                    </span>
                  )}
                </>
              }
            />
            <Field
              label="Commodity"
              value={
                <>
                  {lot.commodity_name ?? '—'}
                  {lot.variety_name && <span className="text-muted-foreground"> / {lot.variety_name}</span>}
                </>
              }
            />
            <Field label="Room" value={lot.chamber_name ?? '—'} />
            <Field label="Rate Plan" value={lot.rate_plan_name ?? '—'} />
            <Field
              label="Bags (Balance / Original)"
              value={
                <>
                  {lot.current_balance_bags.toLocaleString()}
                  <span className="text-muted-foreground"> / {lot.quantity_bags.toLocaleString()}</span>
                </>
              }
            />
            <Field
              label="Weight (Accepted / Declared)"
              value={
                <>
                  {lot.accepted_weight_kg.toLocaleString()} kg
                  {lot.declared_weight_kg != null && (
                    <span className="text-muted-foreground"> / {lot.declared_weight_kg.toLocaleString()} kg</span>
                  )}
                </>
              }
            />
            <Field label="Inbound Date" value={formatDate(lot.inbound_date)} />
            <Field label="Days in Storage" value={lot.days_in_storage} />
            {lot.vehicle_number && <Field label="Vehicle" value={lot.vehicle_number} />}
            {lot.marka && <Field label="Marka" value={<UrduText className="text-sm font-semibold">{lot.marka}</UrduText>} urdu />}
            {lot.quality_grade_inbound && <Field label="Quality Grade" value={`Grade ${lot.quality_grade_inbound}`} />}
            {lot.closed_at && <Field label="Closed At" value={lot.closed_at} />}
          </div>
          {lot.notes && (
            <div className="mt-4 border-t pt-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Notes</p>
              <p className="mt-1 text-sm text-foreground">{lot.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <LotLocationCard lotId={id} canOperate={canWithdraw && canAct} />

      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="border-b px-2">
            <TabsList className="h-auto bg-transparent p-0">
              {([
                ['overview', 'Overview'],
                ['ownership', 'Ownership History'],
                ['movements', 'Movements'],
                ['inspections', 'Inspections'],
                ['withdrawals', 'Withdrawals'],
                ['billing', 'Billing'],
              ] as const).map(([key, label]) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="p-4">
            <TabsContent value="overview" className="mt-0">
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
                <Field label="Entry Date" value={formatDate(lot.entry_date)} />
                <Field label="Created" value={formatDateTime(lot.created_at)} />
                <Field label="Book Type" value={lot.book_type === 'PACCI' ? 'Pacci (Official)' : 'Katchi (Informal)'} />
              </div>
            </TabsContent>

            <TabsContent value="ownership" className="mt-0">
              {lot.marka && (
                <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Physical marka on the bags: </span>
                  <UrduText className="font-semibold text-foreground">{lot.marka}</UrduText>
                  <span className="text-muted-foreground"> — stays constant across transfers; cross-check it against the current owner at dispatch.</span>
                </div>
              )}
              {ownershipHistory.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No ownership history.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead className="text-right">Bags</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Operator</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownershipHistory.map((ev) => (
                      <TableRow key={ev.id}>
                        <TableCell className="font-medium">{EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}</TableCell>
                        <TableCell className="text-muted-foreground">{ev.from_party_name ?? '—'}</TableCell>
                        <TableCell>{ev.to_party_name ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{ev.quantity_bags.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums">{ev.transfer_price_pkr != null ? ev.transfer_price_pkr.toLocaleString() : '—'}</TableCell>
                        <TableCell>{formatDate(ev.effective_date)}</TableCell>
                        <TableCell className="text-muted-foreground">{ev.operator_name ?? '—'}</TableCell>
                        <TableCell className="text-right">
                          {(ev.event_type === 'TRANSFER_OUT' || ev.event_type === 'TRANSFER_IN') && (
                            <Button
                              variant="link"
                              className="h-auto p-0 text-xs"
                              onClick={() => router.push(`/lots/${id}/transfer/${ev.id}/acknowledgment`)}
                            >
                              PDF
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="movements" className="mt-0">
              <LotMovementsTimeline lotId={id} />
            </TabsContent>

            <TabsContent value="inspections" className="mt-0">
              <p className="py-6 text-center text-sm italic text-muted-foreground">
                Quality inspections and spoilage records — available in Phase 6.
              </p>
            </TabsContent>

            <TabsContent value="withdrawals" className="mt-0">
              {outboundEvents.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No withdrawals yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dispatch #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Bags</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outboundEvents.map((ev) => (
                      <TableRow key={ev.id} className="cursor-pointer" onClick={() => router.push(`/outbound-events/${ev.id}`)}>
                        <TableCell className="font-mono">{ev.dispatch_note_number ?? '—'}</TableCell>
                        <TableCell>{ev.withdrawal_type}</TableCell>
                        <TableCell className="text-right tabular-nums">{ev.quantity_withdrawn_bags.toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={ev.status} /></TableCell>
                        <TableCell>{formatDate(ev.outbound_date)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="link" className="h-auto p-0 text-xs">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="billing" className="mt-0">
              {invoices.length === 0 ? (
                <p className="py-6 text-center text-sm italic text-muted-foreground">
                  No invoices yet. Invoices are created automatically when a withdrawal is dispatched.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => (
                      <TableRow key={inv.id} className="cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                        <TableCell className="font-mono">{inv.invoice_number ?? <span className="italic text-muted-foreground">Draft</span>}</TableCell>
                        <TableCell>{formatDate(inv.invoice_date)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{inv.total_pkr.toLocaleString()}</TableCell>
                        <TableCell><StatusBadge status={inv.status} /></TableCell>
                        <TableCell className="text-right">
                          <Button variant="link" className="h-auto p-0 text-xs">View</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </div>
  );
}
