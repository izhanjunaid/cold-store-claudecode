'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';
import { DataTable, type DataTableColumn } from '@/components/data-table';

import { formatMoney } from '@/lib/format';
interface ServiceCharge {
  id: string;
  name: string;
  unit_type: string;
  unit_price_pkr: number;
  is_active: boolean;
}

const UNIT_TYPE_LABELS: Record<string, string> = { PER_BAG: 'Per Bag', PER_TON: 'Per Ton', FLAT: 'Flat' };
const EMPTY = { name: '', unit_type: 'PER_BAG', unit_price_pkr: '' };
const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

export default function ServiceChargeListPage() {
  const confirm = useConfirm();
  const { user } = useAuthStore();
  const canManage = can(user, 'service_charges.manage');

  const [charges, setCharges] = useState<ServiceCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const fetchCharges = async () => {
    setLoading(true);
    try {
      setCharges(await apiClient<ServiceCharge[]>('/v1/service-charges'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCharges();
  }, []);

  const openCreate = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowModal(true);
  };
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
      toast.success('Service charge deactivated');
      fetchCharges();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not deactivate the service charge');
    }
  };

  const columns: DataTableColumn<ServiceCharge>[] = [
      { id: 'name', header: 'Name', enableHiding: false, cell: (sc) => <span className="font-medium">{sc.name}</span>, csv: (sc) => sc.name },
      { id: 'unit_type', header: 'Unit Type', cell: (sc) => UNIT_TYPE_LABELS[sc.unit_type] ?? sc.unit_type, csv: (sc) => sc.unit_type },
      { id: 'price', header: 'Price (PKR)', numeric: true, cell: (sc) => formatMoney(sc.unit_price_pkr), csv: (sc) => sc.unit_price_pkr },
      {
        id: 'status',
        header: 'Status',
        cell: (sc) => <StatusBadge status={sc.is_active ? 'ACTIVE' : 'INACTIVE'} />,
        csv: (sc) => (sc.is_active ? 'Active' : 'Inactive'),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: (sc: ServiceCharge) => (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
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
              ),
            },
          ]
        : []),
  ];

  return (
    <div>
      <PageHeader
        title="Service Charges"
        description="Add-on charges available on invoices"
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              New Service Charge
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={charges}
        meta={undefined}
        isLoading={loading}
        sort={null}
        onSortChange={() => {}}
        page={1}
        perPage={100}
        onPageChange={() => {}}
        onPerPageChange={() => {}}
        getRowId={(sc) => sc.id}
        emptyState={{ title: 'No service charges found' }}
      />

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Service Charge' : 'New Service Charge'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. Loading" />
            </div>
            <div className="space-y-1">
              <Label>Unit Type</Label>
              <select value={form.unit_type} onChange={(e) => setForm((f) => ({ ...f, unit_type: e.target.value }))} className={SELECT_CLASS}>
                <option value="PER_BAG">Per Bag</option>
                <option value="PER_TON">Per Ton</option>
                <option value="FLAT">Flat</option>
              </select>
            </div>
            <div className="space-y-1">
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
