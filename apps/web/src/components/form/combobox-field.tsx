'use client';

import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { cn } from '@/lib/utils';

interface ComboboxFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  description?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  onValueChange?: (value: string) => void;
}

/**
 * Type-ahead entity picker bound to react-hook-form. The trigger carries
 * data-testid="combobox-<name>" for E2E (see e2e/helpers/ui.ts pickCombobox).
 */
export function ComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  options,
  placeholder,
  searchPlaceholder,
  emptyText,
  description,
  required,
  disabled,
  className,
  onValueChange,
}: ComboboxFieldProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem className={cn('space-y-1.5', className)}>
          <FormLabel>
            {label}
            {required && <span className="ml-0.5 text-destructive">*</span>}
          </FormLabel>
          <FormControl>
            <Combobox
              options={options}
              value={field.value ?? ''}
              onChange={(v) => {
                field.onChange(v);
                onValueChange?.(v);
              }}
              placeholder={placeholder}
              searchPlaceholder={searchPlaceholder}
              emptyText={emptyText}
              disabled={disabled}
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
