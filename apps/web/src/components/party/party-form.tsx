'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form, FormActions, EntrySheet, EntryGroup } from '@/components/form';
import { TextField } from '@/components/form/text-field';
import { SelectField } from '@/components/form/select-field';
import { NumberField } from '@/components/form/number-field';
import { MaskedField } from '@/components/form/masked-field';
import { TextareaField } from '@/components/form/textarea-field';
import { apiClient } from '@/lib/api-client';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { applyApiErrorToForm } from '@/lib/form-errors';
import { useParties } from '@/hooks/use-reference-data';
import { qk } from '@/lib/query-keys';

const partySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  name_urdu: z.string(),
  party_type: z.string().min(1),
  phone_primary: z.string().min(1, 'Primary phone is required'),
  phone_secondary: z.string(),
  address: z.string(),
  cnic: z.string(),
  parent_arhti_id: z.string(),
  credit_limit_pkr: z.string(),
  credit_terms_days: z.string(),
  notes: z.string(),
});

export type PartyFormValues = z.infer<typeof partySchema>;

const EMPTY: PartyFormValues = {
  name: '',
  name_urdu: '',
  party_type: 'FARMER',
  phone_primary: '',
  phone_secondary: '',
  address: '',
  cnic: '',
  parent_arhti_id: '',
  credit_limit_pkr: '',
  credit_terms_days: '30',
  notes: '',
};

const PARTY_TYPES = [
  { value: 'FARMER', label: 'Farmer' },
  { value: 'TRADER', label: 'Trader' },
  { value: 'ARHTI', label: 'Arhti' },
  { value: 'BUYER', label: 'Buyer' },
  { value: 'OTHER', label: 'Other' },
];

interface PartyFormProps {
  initialData?: Partial<PartyFormValues>;
  partyId?: string;
  mode: 'create' | 'edit';
}

export function PartyForm({ initialData, partyId, mode }: PartyFormProps) {
  const router = useRouter();
  const { data: parties = [] } = useParties();

  const form = useForm<PartyFormValues>({
    resolver: zodResolver(partySchema),
    defaultValues: { ...EMPTY, ...initialData },
    mode: 'onBlur',
  });
  const { control, handleSubmit, setError } = form;

  const arhtiOptions = useMemo(
    () =>
      parties
        .filter((p) => p.party_type === 'ARHTI' && p.id !== partyId)
        .map((p) => ({ value: p.id, label: p.name })),
    [parties, partyId],
  );

  const save = useApiMutation<{ id: string }, Record<string, unknown>>({
    mutationFn: (payload) =>
      mode === 'create'
        ? apiClient<{ id: string }>('/v1/parties', { method: 'POST', body: payload })
        : apiClient<{ id: string }>(`/v1/parties/${partyId}`, { method: 'PATCH', body: payload }),
    invalidates: [qk.parties.all, qk.reference.parties],
    successMessage: mode === 'create' ? 'Party created' : 'Party updated',
    silentError: true,
    onSuccess: (res) => router.push(`/parties/${mode === 'create' ? res.id : partyId}`),
    onError: (err) => {
      if (!applyApiErrorToForm(err, setError)) {
        setError('root', { message: err instanceof Error ? err.message : 'Failed to save party' });
      }
    },
  });

  const onSubmit = (values: PartyFormValues) => {
    const payload: Record<string, unknown> = {
      name: values.name,
      party_type: values.party_type,
      phone_primary: values.phone_primary,
      credit_terms_days: parseInt(values.credit_terms_days) || 30,
    };
    if (values.name_urdu) payload['name_urdu'] = values.name_urdu;
    if (values.phone_secondary) payload['phone_secondary'] = values.phone_secondary;
    if (values.address) payload['address'] = values.address;
    if (values.cnic) payload['cnic'] = values.cnic;
    if (values.parent_arhti_id) payload['parent_arhti_id'] = values.parent_arhti_id;
    if (values.credit_limit_pkr) payload['credit_limit_pkr'] = parseFloat(values.credit_limit_pkr);
    if (values.notes) payload['notes'] = values.notes;
    save.mutate(payload);
  };

  const rootError = form.formState.errors.root?.message;

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-5xl space-y-3">
        {rootError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {rootError}
          </div>
        )}

        <EntrySheet>
          <EntryGroup title="Identity" columns={4}>
            <TextField control={control} name="name" label="Name" required />
            <TextField control={control} name="name_urdu" label="Name (Urdu)" dir="rtl" />
            <SelectField control={control} name="party_type" label="Party type" options={PARTY_TYPES} />
            <SelectField
              control={control}
              name="parent_arhti_id"
              label="Parent arhti"
              placeholder="None"
              options={arhtiOptions}
            />
          </EntryGroup>

          <EntryGroup title="Contact" columns={4}>
            <MaskedField control={control} name="phone_primary" label="Primary phone" mask="phone" required />
            <MaskedField control={control} name="phone_secondary" label="Secondary phone" mask="phone" />
            <MaskedField control={control} name="cnic" label="CNIC" mask="cnic" />
            <TextField control={control} name="address" label="Address" />
          </EntryGroup>

          <EntryGroup title="Credit" columns={4}>
            <NumberField control={control} name="credit_limit_pkr" label="Credit limit" min={0} suffix="PKR" />
            <NumberField control={control} name="credit_terms_days" label="Credit terms" min={0} suffix="days" />
            <TextareaField control={control} name="notes" label="Notes" rows={1} className="sm:col-span-2" />
          </EntryGroup>
        </EntrySheet>

        <FormActions>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : mode === 'create' ? 'Create Party' : 'Save Changes'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
