'use client';

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { apiClient } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { useDebounced } from '@/hooks/use-debounced';
import { Combobox } from '@/components/ui/combobox';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

export interface PartyRef {
  id: string;
  name: string;
  name_urdu?: string | null;
  party_type?: string;
  phone_primary?: string | null;
}

export interface PartyPickerProps {
  value: string;
  /** `party` is the picked row when it is to hand (absent when cleared). */
  onChange: (id: string, party?: PartyRef) => void;
  /**
   * customer: a party that may be billed, paid by or lent to — the server refuses
   * a supplier on every one of those. supplier: a party bills are entered against.
   */
  kind?: 'customer' | 'supplier';
  /** One party type only (e.g. ARHTI for a parent arhti). */
  type?: string;
  /** Parties not to offer (a party cannot be its own parent; a row already used). */
  exclude?: readonly string[];
  /** For list filters: offers the placeholder as an item that clears the filter. */
  clearable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
  className?: string;
  ariaInvalid?: boolean;
}

const RESULTS = 20;

const typeLabel = (t?: string) => (t ? t.charAt(0) + t.slice(1).toLowerCase() : '');

/**
 * Party picker that searches the server as you type. Loading every party up front
 * capped every picker at the first 100 active parties — party 101 could not be
 * chosen anywhere.
 */
export function PartyPicker({
  value,
  onChange,
  kind,
  type,
  exclude,
  clearable,
  placeholder = 'Select party',
  disabled,
  id,
  testId,
  className,
  ariaInvalid,
}: PartyPickerProps) {
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);

  const params = new URLSearchParams({ is_active: 'true', per_page: String(RESULTS) });
  if (term) params.set('search', term);
  if (kind) params.set('kind', kind);
  if (type) params.set('type', type);
  const query = params.toString();

  const { data: hits = [], isFetching } = useQuery({
    queryKey: qk.parties.search(query),
    queryFn: () => apiClient<PartyRef[]>(`/v1/parties?${query}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const parties = hits.filter((p) => p.id === value || !exclude?.includes(p.id));

  // The chosen party need not be among the current results (a preset value, or a
  // search since typed), so its name is read on its own.
  const { data: chosen } = useQuery({
    queryKey: qk.parties.detail(value),
    queryFn: () => apiClient<PartyRef>(`/v1/parties/${value}`),
    enabled: !!value && !parties.some((p) => p.id === value),
    staleTime: 30_000,
  });

  const options = [
    ...(clearable && value ? [{ value: '', label: placeholder }] : []),
    ...parties.map((p) => ({
      value: p.id,
      label: p.name,
      // A phone tells two parties of the same name apart; the type is only news
      // when the picker is not already restricted to one kind.
      hint: [!kind && !type && typeLabel(p.party_type), p.phone_primary].filter(Boolean).join(' · ') || undefined,
    })),
  ];

  return (
    <Combobox
      options={options}
      value={value}
      onChange={(next) => onChange(next, parties.find((p) => p.id === next) ?? (chosen?.id === next ? chosen : undefined))}
      onSearchChange={setSearch}
      selectedLabel={chosen?.name}
      loading={isFetching}
      placeholder={placeholder}
      searchPlaceholder="Search name or phone…"
      emptyText={term ? 'No matching party.' : kind === 'supplier' ? 'No suppliers yet: add one under Parties (type Supplier).' : 'No parties yet.'}
      disabled={disabled}
      id={id}
      testId={testId}
      className={className}
      ariaInvalid={ariaInvalid}
    />
  );
}

interface PartyFieldProps<T extends FieldValues>
  extends Omit<PartyPickerProps, 'value' | 'onChange' | 'testId' | 'ariaInvalid' | 'id'> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description?: string;
  required?: boolean;
  onValueChange?: (id: string, party?: PartyRef) => void;
}

/**
 * PartyPicker bound to react-hook-form. The trigger carries
 * data-testid="combobox-<name>", as ComboboxField's does (e2e pickCombobox).
 */
export function PartyField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  required,
  className,
  onValueChange,
  ...picker
}: PartyFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={className}>
          <FormLabel>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </FormLabel>
          <FormControl>
            <PartyPicker
              {...picker}
              value={field.value ?? ''}
              onChange={(next, party) => {
                field.onChange(next);
                onValueChange?.(next, party);
              }}
              testId={`combobox-${name}`}
              ariaInvalid={!!fieldState.error}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
