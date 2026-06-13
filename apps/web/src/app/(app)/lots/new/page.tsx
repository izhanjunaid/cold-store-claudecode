'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormSection, SummaryRail, SummaryItem } from '@/components/form';
import { ComboboxField } from '@/components/form/combobox-field';
import { SelectField } from '@/components/form/select-field';
import { NumberField } from '@/components/form/number-field';
import { TextField } from '@/components/form/text-field';
import { MaskedField } from '@/components/form/masked-field';
import { DateField } from '@/components/form/date-field';
import { CheckboxField } from '@/components/form/checkbox-field';
import { TextareaField } from '@/components/form/textarea-field';
import { PageHeader } from '@/components/layout/page-header';
import { apiClient } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { qk } from '@/lib/query-keys';
import {
  useParties,
  useCommodities,
  useVarieties,
  useChambers,
  useRatePlans,
  useFacility,
} from '@/hooks/use-reference-data';

const lotSchema = z
  .object({
    owner_party_id: z.string().min(1, 'Select an owner'),
    billing_override: z.boolean(),
    billing_party_id: z.string(),
    commodity_id: z.string().min(1, 'Select a commodity'),
    variety_id: z.string(),
    chamber_id: z.string().min(1, 'Select a chamber'),
    rate_plan_id: z.string().min(1, 'Select a rate plan'),
    quantity_bags: z.string().min(1, 'Required'),
    declared_weight_kg: z.string(),
    accepted_weight_kg: z.string().min(1, 'Required'),
    weight_dispute_note: z.string(),
    vehicle_number: z.string(),
    marka: z.string(),
    quality_grade_inbound: z.string(),
    inbound_date: z.string(),
    book_type: z.string(),
    notes: z.string(),
  })
  .refine((v) => !v.billing_override || v.billing_party_id.length > 0, {
    message: 'Select a billing party',
    path: ['billing_party_id'],
  });

type LotFormValues = z.infer<typeof lotSchema>;

const DEFAULTS: LotFormValues = {
  owner_party_id: '',
  billing_override: false,
  billing_party_id: '',
  commodity_id: '',
  variety_id: '',
  chamber_id: '',
  rate_plan_id: '',
  quantity_bags: '',
  declared_weight_kg: '',
  accepted_weight_kg: '',
  weight_dispute_note: '',
  vehicle_number: '',
  marka: '',
  quality_grade_inbound: '',
  inbound_date: new Date().toISOString().slice(0, 10),
  book_type: 'PACCI',
  notes: '',
};

interface CreatedLot {
  id: string;
  lot_number: string;
  warnings?: string[];
}

export default function LotCreatePage() {
  const router = useRouter();
  const { data: parties = [] } = useParties();
  const { data: commodities = [] } = useCommodities();
  const { data: varieties = [] } = useVarieties();
  const { data: chambers = [] } = useChambers();
  const { data: ratePlans = [] } = useRatePlans();
  const { data: facility } = useFacility();

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotSchema),
    defaultValues: DEFAULTS,
    mode: 'onBlur',
  });
  const { control, handleSubmit, setValue, setError } = form;

  // Watch the fields that drive the live summary + conditional sections.
  const [commodityId, declaredStr, acceptedStr, qtyStr, chamberId, billingOverride] = useWatch({
    control,
    name: [
      'commodity_id',
      'declared_weight_kg',
      'accepted_weight_kg',
      'quantity_bags',
      'chamber_id',
      'billing_override',
    ],
  });

  // Thresholds come from facility settings (backend enforces both pct AND kg).
  const pctThreshold = facility?.settings?.weight_dispute_threshold_pct ?? 2;
  const kgThreshold = facility?.settings?.weight_dispute_threshold_kg ?? 5;
  const capacityWarnPct = facility?.settings?.chamber_capacity_warning_pct ?? 90;

  const declared = parseFloat(declaredStr) || 0;
  const accepted = parseFloat(acceptedStr) || 0;
  const qty = parseInt(qtyStr) || 0;
  const variancePct = declared > 0 ? (Math.abs(accepted - declared) / declared) * 100 : 0;
  const varianceKg = declared > 0 ? Math.abs(accepted - declared) : 0;
  const hasDispute = declared > 0 && (variancePct > pctThreshold || varianceKg > kgThreshold);

  const partyOptions = useMemo(
    () => parties.map((p) => ({ value: p.id, label: p.name, hint: p.party_type })),
    [parties],
  );

  const filteredVarieties = useMemo(
    () => (commodityId ? varieties.filter((v) => v.commodity_id === commodityId) : varieties),
    [varieties, commodityId],
  );
  const filteredChambers = useMemo(
    () =>
      commodityId
        ? chambers.filter(
            (c) => !c.commodity_restriction_id || c.commodity_restriction_id === commodityId,
          )
        : chambers,
    [chambers, commodityId],
  );
  const filteredPlans = useMemo(
    () =>
      commodityId
        ? ratePlans.filter((p) => !p.commodity_id || p.commodity_id === commodityId)
        : ratePlans,
    [ratePlans, commodityId],
  );

  const selectedChamber = chambers.find((c) => c.id === chamberId);
  const capacityPct = selectedChamber
    ? ((selectedChamber.current_occupancy_bags + qty) / selectedChamber.max_capacity_bags) * 100
    : 0;

  const createLot = useApiMutation<CreatedLot, Record<string, unknown>>({
    mutationFn: (payload) => apiClient<CreatedLot>('/v1/lots', { method: 'POST', body: payload }),
    invalidates: [qk.lots.all],
    successMessage: (lot) => `Lot ${lot.lot_number} created`,
    silentError: true,
    onSuccess: (lot) => router.push(`/lots/${lot.id}`),
    onError: (err) => {
      const applied = applyApiErrorToForm(err, setError);
      if (!applied) {
        setError('root', {
          message: err instanceof Error ? err.message : 'Failed to create lot',
        });
      }
    },
  });

  const onSubmit = (values: LotFormValues) => {
    const payload: Record<string, unknown> = {
      owner_party_id: values.owner_party_id,
      commodity_id: values.commodity_id,
      chamber_id: values.chamber_id,
      rate_plan_id: values.rate_plan_id,
      quantity_bags: parseInt(values.quantity_bags),
      accepted_weight_kg: parseFloat(values.accepted_weight_kg),
    };
    if (values.billing_override && values.billing_party_id)
      payload['billing_party_id'] = values.billing_party_id;
    if (values.variety_id) payload['variety_id'] = values.variety_id;
    if (values.declared_weight_kg) payload['declared_weight_kg'] = parseFloat(values.declared_weight_kg);
    if (hasDispute && values.weight_dispute_note) payload['weight_dispute_note'] = values.weight_dispute_note;
    if (values.vehicle_number) payload['vehicle_number'] = values.vehicle_number;
    if (values.marka) payload['marka'] = values.marka;
    if (values.quality_grade_inbound) payload['quality_grade_inbound'] = values.quality_grade_inbound;
    if (values.inbound_date) payload['inbound_date'] = values.inbound_date;
    if (values.book_type) payload['book_type'] = values.book_type;
    if (values.notes) payload['notes'] = values.notes;
    createLot.mutate(payload);
  };

  const rootError = form.formState.errors.root?.message;

  return (
    <div>
      <PageHeader title="New Inbound Lot" description="Record produce intake and create a storage lot" />

      <Form {...form}>
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-5">
            {rootError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {rootError}
              </div>
            )}

            <FormSection title="Parties" description="Who owns the produce and who is billed">
              <ComboboxField
                control={control}
                name="owner_party_id"
                label="Owner party"
                required
                options={partyOptions}
                placeholder="Select party…"
                searchPlaceholder="Search parties…"
              />
              <CheckboxField
                control={control}
                name="billing_override"
                label="Bill a different party"
                description="By default the owner is billed"
              />
              {billingOverride && (
                <ComboboxField
                  control={control}
                  name="billing_party_id"
                  label="Billing party"
                  required
                  options={partyOptions}
                  placeholder="Select billing party…"
                  searchPlaceholder="Search parties…"
                  className="sm:col-span-2"
                />
              )}
            </FormSection>

            <FormSection title="Goods" description="Commodity, variety and grade">
              <SelectField
                control={control}
                name="commodity_id"
                label="Commodity"
                required
                placeholder="Select commodity…"
                options={commodities.map((c) => ({ value: c.id, label: c.name }))}
                onValueChange={() => {
                  setValue('variety_id', '');
                  setValue('chamber_id', '');
                  setValue('rate_plan_id', '');
                }}
              />
              <SelectField
                control={control}
                name="variety_id"
                label="Variety"
                placeholder="None"
                options={filteredVarieties.map((v) => ({ value: v.id, label: v.name }))}
              />
              <SelectField
                control={control}
                name="quality_grade_inbound"
                label="Quality grade"
                placeholder="Not graded"
                options={[
                  { value: 'A', label: 'Grade A' },
                  { value: 'B', label: 'Grade B' },
                  { value: 'C', label: 'Grade C' },
                ]}
              />
              <TextField
                control={control}
                name="marka"
                label="Marka / brand mark"
                placeholder="e.g. ABC Farms"
                maxLength={100}
              />
            </FormSection>

            <FormSection title="Weights" description="Declared vs accepted weight at intake">
              <NumberField control={control} name="quantity_bags" label="Quantity" required min={1} suffix="bags" />
              <div className="hidden sm:block" aria-hidden />
              <NumberField
                control={control}
                name="declared_weight_kg"
                label="Declared weight"
                min={0}
                step="0.01"
                suffix="kg"
              />
              <NumberField
                control={control}
                name="accepted_weight_kg"
                label="Accepted weight"
                required
                min={0.01}
                step="0.01"
                suffix="kg"
              />
              {hasDispute && (
                <TextareaField
                  control={control}
                  name="weight_dispute_note"
                  label="Dispute note"
                  required
                  rows={2}
                  placeholder="Explain the weight variance…"
                  description={`Variance exceeds the facility threshold (${pctThreshold}% or ${kgThreshold} kg) — a note is required.`}
                  className="sm:col-span-2"
                />
              )}
            </FormSection>

            <FormSection title="Storage & Billing" description="Where it's stored and how it's charged">
              <SelectField
                control={control}
                name="chamber_id"
                label="Chamber"
                required
                placeholder="Select chamber…"
                options={filteredChambers.map((c) => ({
                  value: c.id,
                  label: `${c.name} (${c.available_capacity_bags.toLocaleString()} avail / ${c.max_capacity_bags.toLocaleString()})`,
                }))}
              />
              <SelectField
                control={control}
                name="rate_plan_id"
                label="Rate plan"
                required
                placeholder="Select rate plan…"
                options={filteredPlans.map((p) => ({
                  value: p.id,
                  label: `${p.name} (Rs. ${p.rate_amount_pkr})`,
                }))}
              />
              <SelectField
                control={control}
                name="book_type"
                label="Book type"
                options={[
                  { value: 'PACCI', label: 'Pacci (Official)' },
                  { value: 'KATCHI', label: 'Katchi (Informal)' },
                ]}
              />
            </FormSection>

            <FormSection title="Logistics" description="Vehicle and inbound date">
              <MaskedField control={control} name="vehicle_number" label="Vehicle number" mask="vehicle" />
              <DateField control={control} name="inbound_date" label="Inbound date" />
              <TextareaField control={control} name="notes" label="Notes" rows={2} className="sm:col-span-2" />
            </FormSection>

            <div className="flex gap-3">
              <Button type="submit" disabled={createLot.isPending}>
                {createLot.isPending ? 'Creating…' : 'Create Inbound Lot'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </div>

          <SummaryRail title="Intake summary">
            <SummaryItem label="Quantity" value={qty > 0 ? `${qty.toLocaleString()} bags` : '—'} />
            <SummaryItem label="Accepted weight" value={accepted > 0 ? `${accepted.toLocaleString()} kg` : '—'} />
            <SummaryItem
              label="Weight variance"
              value={declared > 0 ? `${variancePct.toFixed(1)}% · ${varianceKg.toLocaleString()} kg` : '—'}
              tone={hasDispute ? 'danger' : 'default'}
              hint={hasDispute ? 'Dispute note required' : undefined}
            />
            {selectedChamber && (
              <SummaryItem
                label="Chamber fill"
                value={`${capacityPct.toFixed(0)}%`}
                tone={capacityPct > capacityWarnPct ? 'warning' : 'default'}
                hint={capacityPct > 100 ? 'Over capacity' : undefined}
              />
            )}
          </SummaryRail>
        </form>
      </Form>
    </div>
  );
}
