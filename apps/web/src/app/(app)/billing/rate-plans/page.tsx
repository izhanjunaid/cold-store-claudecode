'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
import type { Tariff } from '@coldchain/shared';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth.store';
import { can } from '@/lib/permissions';
import { useCommodities } from '@/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { StatusBadge } from '@/components/ui/status-badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader } from '@/components/layout/page-header';
import { useConfirm } from '@/components/form';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { DEFAULT_TARIFF, TariffFields, tariffIssue } from './tariff-fields';

import { formatDate, formatMoney } from '@/lib/format';
interface RatePlan {
  id: string;
  name: string;
  commodity_id: string | null;
  commodity_name: string | null;
  rate_type: string;
  rate_amount_pkr: number;
  season_start_date: string | null;
  season_end_date: string | null;
  min_billing_days: number;
  tariff: Tariff | null;
  is_active: boolean;
}

const RATE_TYPE_LABELS: Record<string, string> = {
  SEASONAL_PER_BAG: 'Seasonal / Bag',
  MONTHLY_PER_BAG: 'Monthly / Bag',
  DAILY_PER_BAG: 'Daily / Bag',
  TARIFF_PER_BAG: 'Custom tariff',
};
const SELECT_CLASS =
  'flex h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface FormData {
  name: string;
  commodity_id: string;
  rate_type: string;
  rate_amount_pkr: string;
  season_start_date: string;
  season_end_date: string;
  min_billing_days: string;
  tariff: Tariff;
  is_active: boolean;
}
const EMPTY: FormData = {
  name: '',
  commodity_id: '',
  rate_type: 'SEASONAL_PER_BAG',
  rate_amount_pkr: '',
  season_start_date: '',
  season_end_date: '',
  min_billing_days: '1',
  tariff: DEFAULT_TARIFF,
  is_active: true,
};

export default function RatePlanListPage() {
  const confirm = useConfirm();
  const { user } = useAuthStore();
  const canManage = can(user, 'rate_plans.manage');
  const { data: commodities = [] } = useCommodities();

  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isActiveFilter, setIsActiveFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY);
  const [original, setOriginal] = useState<FormData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const qs = isActiveFilter ? `?is_active=${isActiveFilter}` : '';
      setPlans(await apiClient<RatePlan[]>(`/v1/rate-plans${qs}`));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, [isActiveFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof FormData, v: string | boolean | Tariff) => setForm((f) => ({ ...f, [k]: v }));
  const isSeasonal = form.rate_type === 'SEASONAL_PER_BAG';
  const isTariff = form.rate_type === 'TARIFF_PER_BAG';
  const needsSeason = isSeasonal || (isTariff && form.tariff.opening.type === 'SEASON');
  const tariffProblem = isTariff ? tariffIssue(form.tariff, form.season_end_date) : null;

  const openCreate = () => {
    setForm(EMPTY);
    setEditingId(null);
    setShowModal(true);
  };
  const openEdit = (plan: RatePlan) => {
    const next: FormData = {
      name: plan.name,
      commodity_id: plan.commodity_id ?? '',
      rate_type: plan.rate_type,
      rate_amount_pkr: String(plan.rate_amount_pkr),
      season_start_date: plan.season_start_date ?? '',
      season_end_date: plan.season_end_date ?? '',
      min_billing_days: String(plan.min_billing_days),
      tariff: plan.tariff ?? DEFAULT_TARIFF,
      is_active: plan.is_active,
    };
    setForm(next);
    setOriginal(next);
    setEditingId(plan.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const rate = parseFloat(form.rate_amount_pkr);
      const minDays = parseInt(form.min_billing_days) || 1;
      const payload: Record<string, unknown> = { name: form.name, commodity_id: form.commodity_id || null };
      if (editingId) {
        // Only what changed: a plan that lots already use refuses rate changes, and
        // re-sending the unchanged rates must not make a rename look like one.
        if (rate !== parseFloat(original.rate_amount_pkr)) payload['rate_amount_pkr'] = rate;
        if (minDays !== (parseInt(original.min_billing_days) || 1)) payload['min_billing_days'] = minDays;
        if (needsSeason && form.season_start_date !== original.season_start_date) payload['season_start_date'] = form.season_start_date || null;
        if (needsSeason && form.season_end_date !== original.season_end_date) payload['season_end_date'] = form.season_end_date;
        if (isTariff && JSON.stringify(form.tariff) !== JSON.stringify(original.tariff)) payload['tariff'] = form.tariff;
        payload['is_active'] = form.is_active;
        await apiClient(`/v1/rate-plans/${editingId}`, { method: 'PATCH', body: payload });
      } else {
        payload['rate_amount_pkr'] = rate;
        payload['min_billing_days'] = minDays;
        payload['rate_type'] = form.rate_type;
        if (needsSeason) {
          if (form.season_start_date) payload['season_start_date'] = form.season_start_date;
          payload['season_end_date'] = form.season_end_date;
        }
        if (isTariff) payload['tariff'] = form.tariff;
        await apiClient('/v1/rate-plans', { method: 'POST', body: payload });
      }
      setShowModal(false);
      toast.success(editingId ? 'Rate plan updated' : 'Rate plan created');
      fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save rate plan');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!(await confirm({ title: 'Deactivate rate plan?', confirmText: 'Deactivate', destructive: true }))) return;
    try {
      await apiClient(`/v1/rate-plans/${id}`, { method: 'DELETE' });
      toast.success('Rate plan deactivated');
      fetchPlans();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not deactivate the rate plan');
    }
  };

  const columns: DataTableColumn<RatePlan>[] = [
      { id: 'name', header: 'Name', enableHiding: false, cell: (p) => <span className="font-medium">{p.name}</span>, csv: (p) => p.name },
      { id: 'commodity', header: 'Commodity', cell: (p) => p.commodity_name ?? 'All', csv: (p) => p.commodity_name ?? 'All' },
      { id: 'rate_type', header: 'Rate Type', cell: (p) => RATE_TYPE_LABELS[p.rate_type] ?? p.rate_type, csv: (p) => p.rate_type },
      { id: 'rate', header: 'Rate (PKR)', numeric: true, cell: (p) => formatMoney(p.rate_amount_pkr), csv: (p) => p.rate_amount_pkr },
      {
        id: 'season',
        header: 'Season',
        cell: (p) =>
          p.season_start_date && p.season_end_date
            ? `${formatDate(p.season_start_date)} – ${formatDate(p.season_end_date)}`
            : '—',
        csv: (p) => (p.season_start_date && p.season_end_date ? `${p.season_start_date} – ${p.season_end_date}` : ''),
      },
      {
        id: 'status',
        header: 'Status',
        cell: (p) => <StatusBadge status={p.is_active ? 'ACTIVE' : 'INACTIVE'} />,
        csv: (p) => (p.is_active ? 'Active' : 'Inactive'),
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: '',
              enableHiding: false,
              cell: (p: RatePlan) => (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    Edit
                  </Button>
                  {p.is_active && (
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeactivate(p.id)}>
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
        title="Rate Plans"
        description="Storage tariffs by commodity and billing basis"
        actions={
          canManage && (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              New Rate Plan
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={plans}
        meta={undefined}
        isLoading={loading}
        sort={null}
        onSortChange={() => {}}
        page={1}
        perPage={100}
        onPageChange={() => {}}
        onPerPageChange={() => {}}
        getRowId={(p) => p.id}
        toolbar={{
          facets: [
            {
              key: 'is_active',
              label: 'Status',
              options: [
                { label: 'Active', value: 'true' },
                { label: 'Inactive', value: 'false' },
              ],
            },
          ],
        }}
        filterValues={{ is_active: isActiveFilter }}
        onFilterChange={(_key, value) => setIsActiveFilter(value)}
        onResetFilters={() => setIsActiveFilter('')}
        csvFilename="rate-plans"
        emptyState={{ title: 'No rate plans found' }}
      />

      <Dialog open={showModal} onOpenChange={setShowModal}>
        {/* The custom-tariff form is taller than a laptop window: cap the height and scroll,
            or the title and the Create button fall off-screen and cannot be reached. */}
        <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Rate Plan' : 'New Rate Plan'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label>
                Name <span className="text-destructive">*</span>
              </Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} required placeholder="e.g. Potato Seasonal 2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Commodity</Label>
                <select value={form.commodity_id} onChange={(e) => set('commodity_id', e.target.value)} className={SELECT_CLASS}>
                  <option value="">All Commodities</option>
                  {commodities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Rate Type</Label>
                {editingId ? (
                  <Input value={RATE_TYPE_LABELS[form.rate_type] ?? form.rate_type} disabled className="bg-muted text-muted-foreground" />
                ) : (
                  <select value={form.rate_type} onChange={(e) => set('rate_type', e.target.value)} className={SELECT_CLASS}>
                    <option value="SEASONAL_PER_BAG">Seasonal / Bag</option>
                    <option value="MONTHLY_PER_BAG">Monthly / Bag</option>
                    <option value="DAILY_PER_BAG">Daily / Bag</option>
                    <option value="TARIFF_PER_BAG">Custom tariff (½ month, months, days…)</option>
                  </select>
                )}
              </div>
              <div className="space-y-1">
                <Label>
                  {isTariff ? 'Monthly rate per bag (PKR)' : 'Rate Amount (PKR)'} <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step={0.01}
                  min={0.01}
                  value={form.rate_amount_pkr}
                  onChange={(e) => set('rate_amount_pkr', e.target.value)}
                  required
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label>Min Billing Days</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.min_billing_days}
                  onChange={(e) => set('min_billing_days', e.target.value)}
                  className="tabular-nums"
                />
              </div>
              {needsSeason && (
                <>
                  <div className="space-y-1">
                    <Label>
                      Season Start {isSeasonal && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      type="date"
                      value={form.season_start_date}
                      onChange={(e) => set('season_start_date', e.target.value)}
                      required={isSeasonal}
                      className="tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>
                      Season End <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="date"
                      value={form.season_end_date}
                      onChange={(e) => set('season_end_date', e.target.value)}
                      required
                      className="tabular-nums"
                    />
                  </div>
                </>
              )}
            </div>
            {isTariff && (
              <TariffFields
                tariff={form.tariff}
                onChange={(t) => set('tariff', t)}
                monthRate={parseFloat(form.rate_amount_pkr) || 0}
                minDays={parseInt(form.min_billing_days) || 1}
                seasonEnd={form.season_end_date}
              />
            )}
            {editingId && (
              <label className="flex items-center gap-2.5 text-sm">
                <Checkbox checked={form.is_active} onCheckedChange={(c) => set('is_active', !!c)} />
                Active
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !!tariffProblem}>
                {submitting ? 'Saving…' : editingId ? 'Save Changes' : 'Create Rate Plan'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
