'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';

import { formatMoney } from '@/lib/format';
import { DataTableSkeleton } from '@/components/data-table';
interface ServiceCharge {
  id: string;
  name: string;
  unit_type: string;
  unit_price_pkr: number;
  is_active: boolean;
}

const UNIT_TYPE_LABELS: Record<string, string> = { PER_BAG: 'Per Bag', PER_TON: 'Per Ton', FLAT: 'Flat' };
const EMPTY = { name: '', unit_type: 'PER_BAG', unit_price_pkr: '' };
const SELECT_CLASS = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function ServiceChargeListPage() {
  const confirm = useConfirm();
  const [charges, setCharges] = useState<ServiceCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const fetchCharges = useCallback(async () => {
    setLoading(true);
    try {
      setCharges(await apiClient<ServiceCharge[]>('/v1/service-charges'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharges();
  }, [fetchCharges]);

  const openCreate = () => { setForm(EMPTY); setEditingId(null); setShowModal(true); };
  const openEdit = (sc: ServiceCharge) => {
    setForm({ name: sc.name, unit_type: sc.unit_type, unit_price_pkr: String(sc.unit_price_pkr) });
    setEditingId(sc.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = { name: form.name, unit_type: form.unit_type, unit_price_pkr: parseFloat(form.unit_price_pkr) };
      if (editingId) await apiClient(`/v1/service-charges/${editingId}`, { method: 'PATCH', body: payload });
      else await apiClient('/v1/service-charges', { method: 'POST', body: payload });
      setShowModal(false);
      toast.success(editingId ? 'Service charge updated' : 'Service charge created');
      fetchCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!(await confirm({ title: 'Deactivate service charge?', confirmText: 'Deactivate', destructive: true }))) return;
    try {
      await apiClient(`/v1/service-charges/${id}`, { method: 'DELETE' });
      toast.success('Deactivated');
      fetchCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Service Charges"
        description="Add-on charges available on invoices"
        actions={<Button onClick={openCreate}><Plus className="h-4 w-4" aria-hidden />New Service Charge</Button>}
      />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Unit Type</TableHead>
              <TableHead className="text-right">Price (PKR)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <DataTableSkeleton columns={5} rows={5} />
            ) : charges.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No service charges found</TableCell></TableRow>
            ) : (
              charges.map((sc) => (
                <TableRow key={sc.id}>
                  <TableCell className="font-medium">{sc.name}</TableCell>
                  <TableCell>{UNIT_TYPE_LABELS[sc.unit_type] || sc.unit_type}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{formatMoney(sc.unit_price_pkr)}</TableCell>
                  <TableCell><StatusBadge status={sc.is_active ? 'ACTIVE' : 'INACTIVE'} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(sc)}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Edit
                      </Button>
                      {sc.is_active && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeactivate(sc.id)}>
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? 'Edit Service Charge' : 'New Service Charge'}</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Loading" />
            </div>
            <div className="space-y-1.5">
              <Label>Unit Type</Label>
              <select value={form.unit_type} onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value }))} className={SELECT_CLASS}>
                <option value="PER_BAG">Per Bag</option>
                <option value="PER_TON">Per Ton</option>
                <option value="FLAT">Flat</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit Price (PKR)</Label>
              <Input type="number" step={0.01} min={0} value={form.unit_price_pkr} onChange={(e) => setForm((f) => ({ ...f, unit_price_pkr: e.target.value }))} required className="tabular-nums" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : editingId ? 'Save' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
